const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: { type: String, required: [true, 'Name is required'] },
    phone: {
        type: String,
        required: [true, 'Phone number is required'],
        unique: true,
        trim: true
    },
    email: {
        type: String,
        lowercase: true,
        trim: true,
        sparse: true,
        default: null
    },
    password: { type: String, required: [true, 'PIN is required'], minlength: 6, maxlength: 128 },
    role: { type: String, enum: ['user', 'engineer', 'admin'], default: 'user' },
    department: { type: String, default: null },
    city: { type: String, default: '' },
    trustScore: { type: Number, default: 100, min: 0, max: 100 },
    active: { type: Boolean, default: true }
}, { timestamps: true });

// Hash password/PIN before saving
userSchema.pre('save', async function () {
    if (!this.isModified('password')) return;
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
});

// Method to verify password/PIN
userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
