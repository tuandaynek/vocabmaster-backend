import express from 'express'
import { signUp, signIn, signOut, refreshToken, getMe } from '../controllers/authController.js'
import { verifyToken } from '../middlewares/verifyToken.js';

const router = express.Router()

router.post('/register', signUp)
router.post('/login', signIn)
router.post('/logout', signOut)
router.post('/refresh', refreshToken)
router.get('/me', verifyToken, getMe)

export default router