const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { protect } = require('../middleware/authMiddleware');

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// @route   POST /api/auth/register
// @desc    Register a new user with phone + 6-digit PIN
router.post('/register', async (req, res) => {
    try {
        const { name, phone, pin, email, role, department, city } = req.body;

        if (!name || !phone || !pin) {
            return res.status(400).json({ message: 'Please provide name, phone number, and 6-digit PIN' });
        }

        if (!/^\d{6}$/.test(pin)) {
            return res.status(400).json({ message: 'PIN must be exactly 6 digits' });
        }

        const normalizedPhone = phone.replace(/\s+/g, '').trim();

        const userExists = await User.findOne({ phone: normalizedPhone });
        if (userExists) {
            return res.status(400).json({ message: 'An account with this phone number already exists' });
        }

        const user = await User.create({
            name: name.trim(),
            phone: normalizedPhone,
            email: email ? email.toLowerCase().trim() : null,
            password: pin,
            city: city || '',
            role: role || 'user',
            department: (role === 'engineer' || role === 'admin') ? department : null
        });

        const token = generateToken(user._id);

        res.status(201).json({
            _id: user._id,
            name: user.name,
            phone: user.phone,
            email: user.email,
            role: user.role,
            department: user.department,
            city: user.city,
            trustScore: user.trustScore,
            active: user.active,
            token
        });
    } catch (error) {
        console.error('[Auth Register Error]', error);
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern || {})[0] || 'phone';
            const msg = field === 'email'
                ? 'An account with this email already exists'
                : 'An account with this phone number already exists';
            return res.status(400).json({ message: msg });
        }
        res.status(500).json({ message: error.message || 'Server error during registration' });
    }
});

// @route   POST /api/auth/login
// @desc    Authenticate user with phone + PIN & return token
router.post('/login', async (req, res) => {
    try {
        const { phone, pin } = req.body;

        if (!phone || !pin) {
            return res.status(400).json({ message: 'Please provide phone number and PIN' });
        }

        const normalizedPhone = phone.replace(/\s+/g, '').trim();

        const user = await User.findOne({ phone: normalizedPhone });
        if (!user) {
            return res.status(401).json({ message: 'Invalid phone number or PIN' });
        }

        const isMatch = await user.matchPassword(pin);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid phone number or PIN' });
        }

        if (!user.active) {
            return res.status(401).json({ message: 'Your account has been suspended by an administrator' });
        }

        const token = generateToken(user._id);

        res.json({
            _id: user._id,
            name: user.name,
            phone: user.phone,
            email: user.email,
            role: user.role,
            department: user.department,
            city: user.city,
            trustScore: user.trustScore,
            active: user.active,
            token
        });
    } catch (error) {
        console.error('[Auth Login Error]', error);
        res.status(500).json({ message: 'Server error during login' });
    }
});

// @route   GET /api/auth/me
// @desc    Get logged-in user profile
router.get('/me', protect, async (req, res) => {
    res.json(req.user);
});

module.exports = router;
