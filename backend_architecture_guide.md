# 🏛️ BACKEND ARCHITECTURE & DEVELOPMENT GUIDELINE
*Project: VocabAI & Grammar Quest System*
*Target: AI Assistants, Code Generators, & Developers*

---

## 📂 1. CẤU TRÚC THƯ MỤC VÀ PHÂN TẦNG (DIRECTORY STRUCTURE)

Hệ thống Backend tuân thủ nghiêm ngặt mô hình **Layered Architecture (Phân tầng kiến trúc)** nhằm tách biệt rõ ràng trách nhiệm của từng thành phần:

```text
src/
├── lib/                   # Chứa các clients kết nối dịch vụ ngoài
│   ├── supabase.js        # Khởi tạo và quản lý Supabase client (Database)
│   └── groq.js            # Chứa hàm callGroqWithFallback cho AI
├── services/              # Tầng xử lý logic nghiệp vụ, Database queries & AI calls
│   └── grammar.service.js # Toàn bộ logic thao tác DB và gọi AI cho module Grammar
├── controllers/           # Tầng điều phối HTTP Request / Response 
│   └── grammar.controller.js # Nhận req, gọi service, trả res (KHÔNG viết SQL/AI ở đây)
└── routes/                # Tầng định nghĩa Endpoint
    └── grammar.routes.js  # Khai báo các route và gắn middleware (verifyAdminToken)

🔄 2. LUỒNG XỬ LÝ DỮ LIỆU (REQUEST FLOW)
Mọi HTTP Request từ client khi đi vào Backend bắt buộc phải tuân theo luồng một chiều sau đây:

[ Client Request ] 
       │
       ▼
[ /routes ] ➔ Định nghĩa Endpoint & áp dụng Middleware (VD: verifyAdminToken)
       │
       ▼
[ /controllers ] ➔ Nhận req, trích xuất params/body, gọi Service tương ứng, trả về res JSON
       │
       ▼
[ /services ] ➔ Chứa toàn bộ Business Logic, gọi Database qua supabase.js hoặc gọi AI qua groq.js
       │
       ▼
[ ./lib/supabase.js & ./lib/groq.js ] ➔ Giao tiếp với PostgreSQL & Groq AI Model

📐 3. QUY TẮC PHÂN NHIỆM (RESPONSIBILITY RULES)
🔴 3.1. Tầng Routes (/routes)
    - Chỉ làm nhiệm vụ điều hướng URL đến đúng Controller.
    - Áp dụng các Middleware bảo mật (VD: verifyAdminToken, rateLimiter).
    - Tuyệt đối không viết logic xử lý dữ liệu hay câu lệnh SQL tại đây.

🟡 3.2. Tầng Controllers (/controllers)
    - Nhận đối tượng req và res.
    - Thực hiện validate dữ liệu đầu vào cơ bản (kiểm tra thiếu field bắt buộc, type cơ bản).
    - Gọi các hàm tương ứng từ tầng services và bọc trong khối try/catch để xử lý lỗi HTTP chuẩn (200, 201, 400, 401, 403, 500).

🛑 LƯU Ý TỐI QUAN TRỌNG: Các file trong thư mục /controllers KHÔNG ĐƯỢC PHÉP gọi trực tiếp câu lệnh database hay gọi API AI. Mọi thao tác đó phải ủy quyền hoàn toàn cho Service.

🟢 3.3. Tầng Services (/services)
    - Nơi tập trung toàn bộ Business Logic của ứng dụng.
    - Thực hiện các câu lệnh truy vấn Database thông qua lib/supabase.js.
    - Thực hiện gọi AI thông qua hàm callGroqWithFallback(prompt, systemInstruction, temperature) từ lib/groq.js.
    - Trả kết quả (data hoặc throw error) ngược lại về cho Controller.

⚡ 4. TIÊU CHUẨN TỐI ƯU HÓA VÀ CLEAN CODE (PERFORMANCE RULES)
    - Batch Queries (Hạn chế N+1 Query):
        + Khi truy vấn dữ liệu có quan hệ (VD: Lấy danh sách Topic kèm Sub-topics), phải dùng các kỹ thuật gộp câu lệnh, Join, hoặc Promise.all chạy song song. Tuyệt đối không viết vòng lặp gọi database lắt nhắt từng dòng (gây hiện tượng N+1 query làm sập hiệu năng).

    - Tối ưu số dòng code (Concise & Clean):

        + Tránh lặp code (DRY - Don't Repeat Yourself). Tách các đoạn logic xử lý chung thành các helper function dùng chung.

        + Sử dụng cú pháp async/await hiện đại, kết hợp destructing object gọn gàng.

    - Quản lý lỗi tập trung:

        + Không bỏ trống khối try/catch. Khi Service gặp lỗi, phải throw error với thông điệp rõ ràng để Controller bắt được và trả về client format chuẩn: { success: false, error: "..." }.

🛠️ 5. MẪU THỰC THI CHUẨN (REFERENCE PATTERN)
Dưới đây là ví dụ chuẩn cho một tính năng Admin (VD: Tạo mới Chủ đề lớn):

    A. services/grammar.service.js (Tầng Service - Xử lý DB)
    import { supabase } from '../lib/supabase.js';

    export const createGrammarTopicService = async (topicData) => {
        const { title, category, description, level, badgeColor, iconBg } = topicData;
        
        const { data, error } = await supabase
            .from('grammar_topics')
            .insert([{ title, category, description, level, badge_color: badgeColor, icon_bg: iconBg }])
            .select()
            .single();

        if (error) throw new Error(error.message);
        return data;
    };

    B. controllers/grammarController.js (Tầng Controller - Xử lý HTTP)
    import * as grammarService from '../services/grammarService.js';

    export const createTopicController = async (req, res) => {
        try {
            const { title, level } = req.body;
            if (!title || !level) {
                return res.status(400).json({ success: false, error: 'Thiếu thông tin tiêu đề hoặc cấp độ!' });
            }

            const newTopic = await grammarService.createGrammarTopicService(req.body);
            return res.status(201).json({ success: true, data: newTopic });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    };

    C. routes/grammar.routes.js (Tầng Routes - Định tuyến)
    import express from 'express';
    import { createTopicController } from '../controllers/grammar.controller.js';
    import { verifyAdminToken } from '../middleware/verifyAdminToken.js'; // Giả định middleware phân quyền

    const router = express.Router();

    // Route quản lý Admin: Bắt buộc đi qua verifyAdminToken -> Controller
    router.post('/admin/grammar/topics', verifyAdminToken, createTopicController);

    export default router;