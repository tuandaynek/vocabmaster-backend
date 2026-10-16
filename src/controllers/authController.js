import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { supabase } from '../lib/supabase.js'

// JWT accept string format like "15m", "30m"
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || "30m"; 
const REFRESH_TOKEN_TTL_MS = parseInt(process.env.REFRESH_TOKEN_TTL_MS) || (14 * 24 * 60 * 60 * 1000);

export const signUp = async (req, res) => {
    try {
        const { username, password, email } = req.body;
        
        if (!username || !password || !email) {
            return res.status(400).json({ message: "All fields are required" });
        }

        // 1. Kiểm tra username hoặc email đã tồn tại chưa
        const { data: existingUser, error: findError } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .maybeSingle();

        if (findError) {
            console.error("Supabase find user error:", findError);
            return res.status(500).json({ message: "Lỗi kết nối CSDL" });
        }

        if (existingUser) {
            return res.status(409).json({ message: "Username or Email already taken" });
        }

        // 2. Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 3. Insert User mới vào Supabase
        const { error: insertError } = await supabase
            .from('users')
            .insert([
                {
                    username,
                    email,
                    password: hashedPassword,
                }
            ]);

        if (insertError) {
            console.error("Supabase insert user error:", insertError);
            return res.status(500).json({ message: "Lỗi tạo tài khoản" });
        }

        return res.sendStatus(201);
    } catch (error) {
        console.error("Error during user signup:", error);
        return res.status(500).json({ message: "Lỗi hệ thống" });
    }
}

export const signIn = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: "All fields are required" });
        }

        // 1. Tìm user theo email
        const { data: user, error: findError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();

        if (findError || !user) {
            return res.status(401).json({ message: "Email or password is incorrect" });
        }

        // 2. Kiểm tra password
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ message: "Email or password is incorrect" });
        }

        // 3. Tạo AccessToken
        const accessToken = jwt.sign(
            { userId: user.id },
            process.env.JWT_SECRET,
            { expiresIn: ACCESS_TOKEN_TTL }
        );

        // 4. Tạo RefreshToken ngẫu nhiên
        const refreshToken = crypto.randomBytes(64).toString('hex');
        const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();

        // 5. Lưu Session vào Supabase
        const { error: sessionError } = await supabase
            .from('sessions')
            .insert([
                {
                    user_id: user.id,
                    refresh_token: refreshToken,
                    expires_at: expiresAt
                }
            ]);

        if (sessionError) {
            console.error("Supabase create session error:", sessionError);
            return res.status(500).json({ message: "Lỗi tạo phiên đăng nhập" });
        }

        // 6. Trả RefreshToken về Cookie
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production', // true trên production
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            maxAge: REFRESH_TOKEN_TTL_MS
        });
        
        return res.status(200).json({ 
            message: `User ${user.username || user.email} logged in!`, 
            accessToken,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error("Error during user signin:", error);
        return res.status(500).json({ message: "Lỗi hệ thống" });
    }
}

export const signOut = async (req, res) => {
    try {
        const token = req.cookies?.refreshToken;

        if (token) {
            // 1. Xóa session trong Supabase DB
            await supabase
                .from('sessions')
                .delete()
                .eq('refresh_token', token);

            // 2. Xóa Cookie
            res.clearCookie('refreshToken', {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
            });
        }

        return res.sendStatus(204);
    } catch (error) {
        console.error("Error during user signout:", error);
        return res.status(500).json({ message: "Lỗi hệ thống" });
    }
}

export const refreshToken = async (req, res) => {
    try {
        const token = req.cookies?.refreshToken;
        if (!token) {
            return res.status(401).json({ message: "No refresh token provided" });
        }

        // 1. Lấy thông tin session từ Supabase
        const { data: session, error: sessionError } = await supabase
            .from('sessions')
            .select('*')
            .eq('refresh_token', token)
            .maybeSingle();

        if (sessionError || !session) {
            return res.status(403).json({ message: "Invalid refresh token" });
        }

        // 2. Kiểm tra token hết hạn
        if (new Date(session.expires_at) < new Date()) {
            // Xóa token hết hạn khỏi database
            await supabase
                .from('sessions')
                .delete()
                .eq('refresh_token', token);

            return res.status(403).json({ message: "Refresh token expired" });
        }

        // 3. Cấp AccessToken mới
        const accessToken = jwt.sign(
            { userId: session.user_id },
            process.env.JWT_SECRET,
            { expiresIn: ACCESS_TOKEN_TTL }
        );

        return res.status(200).json({ accessToken });
    } catch (error) {
        console.error("Error during token refresh:", error);
        return res.status(500).json({ message: "Lỗi hệ thống" });
    }
}

export const getMe = async (req, res) => {
  try {
    // req.user.userId được giải mã từ verifyToken middleware
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, email, created_at, role')
      .eq('id', userId)
      .maybeSingle();

    if (error || !user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      createdAt: user.created_at
    });

  } catch (error) {
    console.error("Error in getMe:", error);
    return res.status(500).json({ message: "Lỗi hệ thống" });
  }
};