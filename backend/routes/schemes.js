const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { getSchemesBySector, getAllSectorSchemes, getAllSchemes } = require('../services/pibService');
const router = express.Router();

// GET /api/schemes — all schemes grouped by sector (protected)
router.get('/', protect, async (req, res) => {
    try {
        const data = await getAllSectorSchemes();
        res.json({ success: true, data });
    } catch (error) {
        console.error('Schemes fetch error:', error.message);
        res.status(500).json({ message: 'Failed to fetch schemes from PIB' });
    }
});

// GET /api/schemes/sector/:sector — specific sector (protected)
router.get('/sector/:sector', protect, async (req, res) => {
    try {
        const { sector } = req.params;
        const schemes = await getSchemesBySector(sector);
        res.json({ success: true, sector, schemes });
    } catch (error) {
        console.error('Sector fetch error:', error.message);
        res.status(500).json({ message: 'Failed to fetch sector schemes' });
    }
});

// GET /api/schemes/all — all latest PIB releases (protected, no filter)
router.get('/all', protect, async (req, res) => {
    try {
        const schemes = await getAllSchemes();
        res.json({ success: true, count: schemes.length, schemes });
    } catch (error) {
        console.error('All schemes error:', error.message);
        res.status(500).json({ message: 'Failed to fetch all schemes' });
    }
});

module.exports = router;
