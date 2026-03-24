const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { MasterTicket, RawComplaint } = require('../models/Ticket');
const { protect, authorize } = require('../middleware/authMiddleware');

const SEVERITY_THRESHOLDS = { Medium: 3, High: 10, Critical: 25 };
const DEDUP_RADIUS_METERS = 50;

function calculateSeverity(count) {
    if (count >= SEVERITY_THRESHOLDS.Critical) return "Critical";
    if (count >= SEVERITY_THRESHOLDS.High) return "High";
    if (count >= SEVERITY_THRESHOLDS.Medium) return "Medium";
    return "Low";
}

function hasGeoCoordinates(lat, lng) {
    return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
}

// Helper: Format ticket for frontend
function formatTicket(t) {
    const obj = t.toObject ? t.toObject() : t;
    return {
        ...obj,
        id: obj._id,
        lat: obj.location ? obj.location.coordinates[1] : null,
        lng: obj.location ? obj.location.coordinates[0] : null,
    };
}

// ─── POST /api/tickets/complaint ─── Submit a new complaint
router.post('/complaint', protect, async (req, res) => {
    try {
        const { category, description, landmark, lat, lng, accuracy, department } = req.body;

        if (!category) {
            return res.status(400).json({ message: 'Category is required' });
        }
        if (!description) {
            return res.status(400).json({ message: 'Description is required' });
        }

        let matchingTicket = null;
        let isNew = false;

        // Spatial deduplication using MongoDB 2dsphere
        const hasLocation = hasGeoCoordinates(lat, lng);

        if (hasLocation) {
            const latNum = Number(lat);
            const lngNum = Number(lng);
            try {
                const nearbyTickets = await MasterTicket.find({
                    intentCategory: category,
                    status: { $nin: ['Closed', 'Invalid_Spam'] },
                    location: {
                        $near: {
                            $geometry: { type: "Point", coordinates: [lngNum, latNum] },
                            $maxDistance: DEDUP_RADIUS_METERS
                        }
                    }
                }).limit(1);

                if (nearbyTickets.length > 0) {
                    matchingTicket = nearbyTickets[0];
                }
            } catch (geoErr) {
                // If 2dsphere index doesn't exist yet, skip dedup
                console.warn('[Dedup] Geo query failed (index may not exist yet):', geoErr.message);
            }
        }

        if (matchingTicket) {
            matchingTicket.complaintCount += 1;
            matchingTicket.severity = calculateSeverity(matchingTicket.complaintCount);
            if (!matchingTicket.department && department) matchingTicket.department = department;
            await matchingTicket.save();
        } else {
            isNew = true;
            matchingTicket = new MasterTicket({
                intentCategory: category,
                description: description,
                severity: "Low",
                complaintCount: 1,
                status: "Open",
                department: department || null,
                needsManualGeo: !hasLocation,
                landmark: landmark || "",
                city: req.user.city || "",
                location: hasLocation ? { type: "Point", coordinates: [Number(lng), Number(lat)] } : undefined,
                ticketNumber: 'TKT-' + Math.floor(100000 + Math.random() * 900000)
            });
            await matchingTicket.save();
        }

        // Save raw complaint
        const complaint = new RawComplaint({
            userId: req.user._id,
            transcriptOriginal: description,
            transcriptEnglish: description,
            intentCategory: category,
            extractedLandmark: landmark || '',
            location: hasLocation ? { type: "Point", coordinates: [Number(lng), Number(lat)] } : undefined,
            geoAccuracy: accuracy,
            department: department,
            source: 'web_form',
            status: matchingTicket.status,
            masterTicketId: matchingTicket._id
        });
        await complaint.save();

        res.status(201).json({
            ticketId: matchingTicket._id,
            isNew,
            ticket: formatTicket(matchingTicket),
            needsManualGeo: matchingTicket.needsManualGeo
        });

    } catch (err) {
        console.error('[Complaint Submit Error]', err);
        res.status(500).json({ message: err.message || 'Failed to submit complaint' });
    }
});

// ─── GET /api/tickets/my-complaints ─── User's own complaints
router.get('/my-complaints', protect, async (req, res) => {
    try {
        const complaints = await RawComplaint.find({ userId: req.user._id })
            .sort({ createdAt: -1 })
            .lean()
            .maxTimeMS(10000);
        
        console.log(`[MyComplaints] User ${req.user._id}: found ${complaints.length} total complaints | sources: ${[...new Set(complaints.map(c=>c.source))].join(', ')}`);

        const ticketIds = [...new Set(
            complaints
                .map(c => c.masterTicketId)
                .filter(id => id && mongoose.Types.ObjectId.isValid(id))
                .map(id => id.toString())
        )];

        const tickets = ticketIds.length
            ? await MasterTicket.find({ _id: { $in: ticketIds } }).lean().maxTimeMS(10000)
            : [];

        const ticketMap = new Map(tickets.map(t => [t._id.toString(), t]));

        const enriched = complaints.map(c => ({
            ...c,
            id: c._id,
            ticket: c.masterTicketId && ticketMap.has(c.masterTicketId.toString())
                ? { ...ticketMap.get(c.masterTicketId.toString()), id: c.masterTicketId.toString() }
                : null
        }));
        res.json(enriched);
    } catch (err) {
        console.error('[My Complaints Error]', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── GET /api/tickets/nearby ─── Nearby active tickets for citizen map
router.get('/nearby', protect, async (req, res) => {
    try {
        const { lat, lng, radius } = req.query;
        if (!hasGeoCoordinates(lat, lng)) {
            return res.status(400).json({ message: 'lat and lng are required' });
        }

        const maxDistance = parseInt(radius, 10) || 5000; // default 5km

        const tickets = await MasterTicket.find({
            status: { $nin: ['Closed', 'Invalid_Spam'] },
            location: {
                $nearSphere: {
                    $geometry: { type: "Point", coordinates: [Number(lng), Number(lat)] },
                    $maxDistance: maxDistance
                }
            }
        }).limit(100);

        res.json(tickets.map(formatTicket));
    } catch (err) {
        console.error('[Nearby Tickets Error]', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── GET /api/tickets/master ─── All master tickets (filtered by role)
router.get('/master', protect, async (req, res) => {
    try {
        const query = {};
        const assignedDistrict = (req.user.city || '').trim();
        if (assignedDistrict) {
            query.city = assignedDistrict;
        } else if (['admin', 'engineer'].includes(req.user.role)) {
            return res.json([]);
        }

        if (req.user.role === 'engineer' && req.user.department) {
            query.department = req.user.department;
            query.$or = [{ assignedEngineerId: req.user._id }, { assignedEngineerId: null }];
            query.status = { $ne: 'Closed' };
        } else if (req.query.needsManualGeo === 'true') {
            query.needsManualGeo = true;
            query.status = { $nin: ['Closed', 'Invalid_Spam'] };
        }

        const tickets = await MasterTicket.find(query)
            .populate('assignedEngineerId', 'name email phone department')
            .sort({ updatedAt: -1 });

        res.json(tickets.map(formatTicket));
    } catch (err) {
        console.error('[Master Tickets Error]', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── GET /api/tickets/master/:id ─── Single ticket detail
router.get('/master/:id', protect, async (req, res) => {
    try {
        const ticket = await MasterTicket.findById(req.params.id)
            .populate('assignedEngineerId', 'name email phone');
        if (!ticket) return res.status(404).json({ message: "Ticket not found" });
        res.json(formatTicket(ticket));
    } catch (err) {
        console.error('[Ticket Detail Error]', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── PUT /api/tickets/master/:id ─── Update ticket
router.put('/master/:id', protect, authorize('admin', 'engineer'), async (req, res) => {
    try {
        const ticket = await MasterTicket.findById(req.params.id);
        if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

        const isAdmin = req.user.role === 'admin';
        const isEngineer = req.user.role === 'engineer';
        const isAssignedEngineer = ticket.assignedEngineerId && ticket.assignedEngineerId.toString() === req.user._id.toString();
        const isEligibleUnassignedEngineer = !ticket.assignedEngineerId && req.user.department && ticket.department === req.user.department;

        if (isEngineer && !isAssignedEngineer && !isEligibleUnassignedEngineer) {
            return res.status(403).json({ message: 'Engineers can only update assigned or own-department unassigned tickets' });
        }

        if (isEngineer) {
            const restrictedFields = ['status', 'assignedEngineerId', 'needsManualGeo', 'severity', 'complaintCount', 'department', 'city', 'lat', 'lng'];
            const attemptedRestrictedField = restrictedFields.some((field) => req.body[field] !== undefined);
            if (attemptedRestrictedField) {
                return res.status(403).json({ message: 'Engineers are not allowed to modify admin-controlled fields' });
            }
        }

        // Dynamic field updates
        const allowedFields = ['status', 'assignedEngineerId', 'needsManualGeo', 'resolutionNotes', 'severity', 'complaintCount', 'department', 'landmark', 'city', 'progressPercent'];
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                if (isEngineer && !['progressPercent', 'resolutionNotes'].includes(field)) return;
                if (field === 'assignedEngineerId' && !req.body[field]) {
                    ticket[field] = null;
                } else {
                    ticket[field] = req.body[field];
                }
            }
        });

        if (isEngineer && req.body.progressPercent !== undefined && Number(req.body.progressPercent) < 100) {
            ticket.status = 'In_Progress';
        }

        // Manual coordinate fix from Admin
        if (isAdmin && hasGeoCoordinates(req.body.lat, req.body.lng)) {
            ticket.location = { type: 'Point', coordinates: [Number(req.body.lng), Number(req.body.lat)] };
        }

        // Engineer resolution submission
        if (hasGeoCoordinates(req.body.resolutionLat, req.body.resolutionLng)) {
            ticket.resolutionLocation = { type: 'Point', coordinates: [Number(req.body.resolutionLng), Number(req.body.resolutionLat)] };
            ticket.resolutionImageUrl = req.body.resolutionImageUrl;
            ticket.resolutionTimestamp = new Date();
            ticket.status = 'Pending_Verification';
        }

        await ticket.save();
        res.json(formatTicket(ticket));
    } catch (err) {
        console.error('[Ticket Update Error]', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── PUT /api/tickets/master/:id/verify ─── Citizen verifies resolution
router.put('/master/:id/verify', protect, authorize('user', 'admin'), async (req, res) => {
    try {
        const ticket = await MasterTicket.findById(req.params.id);
        if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

        if (req.user.role !== 'admin') {
            const hasComplaint = await RawComplaint.exists({
                userId: req.user._id,
                masterTicketId: ticket._id
            });
            if (!hasComplaint) {
                return res.status(403).json({ message: 'You can only verify tickets linked to your complaints' });
            }
        }

        const { verified, rating, feedback } = req.body;

        if (verified) {
            ticket.status = 'Closed';
        } else {
            ticket.status = 'Disputed';
        }

        if (rating !== undefined) ticket.citizenRating = rating;
        if (feedback !== undefined) ticket.citizenFeedback = feedback;

        await ticket.save();
        res.json(formatTicket(ticket));
    } catch (err) {
        console.error('[Ticket Verify Error]', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── POST /api/tickets/master/:id/upvote ─── Citizen +1 upvote with proof
router.post('/master/:id/upvote', protect, authorize('user'), async (req, res) => {
    try {
        const ticket = await MasterTicket.findById(req.params.id);
        if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

        // Check if user already upvoted
        const alreadyUpvoted = ticket.upvoters.some(
            u => u.userId && u.userId.toString() === req.user._id.toString()
        );
        if (alreadyUpvoted) {
            return res.status(400).json({ message: 'You have already upvoted this issue' });
        }

        const { proofImageUrl } = req.body;
        if (!proofImageUrl) {
            return res.status(400).json({ message: 'Proof image is required to upvote' });
        }

        // Add upvote
        ticket.upvoters.push({
            userId: req.user._id,
            proofImageUrl: proofImageUrl
        });
        ticket.complaintCount += 1;
        ticket.severity = calculateSeverity(ticket.complaintCount);

        await ticket.save();
        res.json({
            message: 'Upvote recorded successfully!',
            ticket: formatTicket(ticket)
        });
    } catch (err) {
        console.error('[Upvote Error]', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── PUT /api/tickets/master/:id/recomplaint ─── Citizen re-opens resolved ticket
router.put('/master/:id/recomplaint', protect, authorize('user', 'admin'), async (req, res) => {
    try {
        const ticket = await MasterTicket.findById(req.params.id);
        if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

        if (req.user.role !== 'admin') {
            const hasComplaint = await RawComplaint.exists({
                userId: req.user._id,
                masterTicketId: ticket._id
            });
            if (!hasComplaint) {
                return res.status(403).json({ message: 'You can only re-complain on tickets linked to your complaints' });
            }
        }

        const { feedback } = req.body;
        if (!feedback || !feedback.trim()) {
            return res.status(400).json({ message: 'Feedback is required for re-complaint' });
        }

        ticket.status = 'Disputed';
        ticket.reComplaintFeedback = feedback.trim();
        ticket.reComplaintCount = (ticket.reComplaintCount || 0) + 1;
        ticket.progressPercent = 0;

        await ticket.save();
        res.json(formatTicket(ticket));
    } catch (err) {
        console.error('[Re-complaint Error]', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── GET /api/tickets/stats ─── Dashboard stats (admin)
router.get('/stats', protect, authorize('admin'), async (req, res) => {
    try {
        const [total, open, critical, pendingGeo] = await Promise.all([
            MasterTicket.countDocuments(),
            MasterTicket.countDocuments({ status: { $nin: ['Closed', 'Invalid_Spam'] } }),
            MasterTicket.countDocuments({ severity: 'Critical', status: { $nin: ['Closed'] } }),
            MasterTicket.countDocuments({ needsManualGeo: true, status: { $nin: ['Closed'] } })
        ]);
        res.json({ total, open, critical, pendingGeo });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
