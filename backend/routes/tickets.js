const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { MasterTicket, RawComplaint } = require('../models/Ticket');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/authMiddleware');
const { classifyProblemLevel } = require('../data/problemLevels');

const SEVERITY_THRESHOLDS = { Medium: 3, High: 10, Critical: 25 };
const DEDUP_RADIUS_METERS = 50;

// SLA deadlines by department (hours)
const SLA_HOURS = {
    municipal: 24, pwd: 72, water_supply: 24, electricity: 12,
    transport: 48, health: 12, police: 6, fire: 2,
    environment: 72, education: 168, revenue: 168,
    social_welfare: 168, food_civil: 48, urban_dev: 168,
    telecom: 72, forest: 168
};

function calculateSeverity(count) {
    if (count >= SEVERITY_THRESHOLDS.Critical) return "Critical";
    if (count >= SEVERITY_THRESHOLDS.High) return "High";
    if (count >= SEVERITY_THRESHOLDS.Medium) return "Medium";
    return "Low";
}

function hasGeoCoordinates(lat, lng) {
    return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
}

function calculatePhase(percent) {
    if (percent <= 20) return 1;
    if (percent <= 40) return 2;
    if (percent <= 60) return 3;
    if (percent <= 80) return 4;
    return 5;
}

function formatTicket(t) {
    const obj = t.toObject ? t.toObject() : t;
    return {
        ...obj,
        id: obj._id,
        lat: obj.location ? obj.location.coordinates[1] : null,
        lng: obj.location ? obj.location.coordinates[0] : null,
    };
}

function calculateSlaDeadline(department) {
    const hours = SLA_HOURS[department] || 72;
    return new Date(Date.now() + hours * 60 * 60 * 1000);
}

// ── Auto-assign to junior with fewest active tickets ──
async function autoAssignJunior(department, city) {
    if (!department) return null;
    try {
        const juniors = await User.find({
            role: { $in: ['junior', 'engineer'] },
            department: department,
            active: true,
            ...(city ? { city: { $regex: city, $options: 'i' } } : {})
        }).select('_id name').lean();

        if (juniors.length === 0) return null;

        // Count active (non-closed) tickets per junior
        const counts = await Promise.all(
            juniors.map(async (j) => {
                const count = await MasterTicket.countDocuments({
                    $or: [{ assignedJuniorId: j._id }, { assignedEngineerId: j._id }],
                    status: { $nin: ['Closed', 'Rejected', 'Invalid_Spam'] }
                });
                return { junior: j, count };
            })
        );

        // Sort by fewest active tickets
        counts.sort((a, b) => a.count - b.count);
        return counts[0].junior;
    } catch (err) {
        console.warn('[AutoAssign] Failed:', err.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════════
// SHARED: createComplaintFromData
// Used by BOTH manual web form AND voice auto-fill pipeline.
// This is the single source of truth for complaint creation.
// ═══════════════════════════════════════════════════════
async function createComplaintFromData(data, user = null) {
    const {
        primaryCategory, subCategory, description, landmark,
        lat, lng, accuracy, department,
        zone, wardNumber, locality, pincode,
        citizenImages, isAnonymous,
        source, audioUrl, callerPhone, callerPhoneRaw,
        transcriptOriginal, transcriptEnglish, severity
    } = data;

    const category = primaryCategory || data.category;
    if (!category) throw new Error('Category is required');
    if (!description) throw new Error('Description is required');

    let matchingTicket = null;
    let isNew = false;
    const hasLocation = hasGeoCoordinates(lat, lng);

    // Spatial deduplication
    if (hasLocation) {
        try {
            const nearbyTickets = await MasterTicket.find({
                primaryCategory: category,
                status: { $nin: ['Closed', 'Invalid_Spam', 'Rejected'] },
                location: {
                    $near: {
                        $geometry: { type: "Point", coordinates: [Number(lng), Number(lat)] },
                        $maxDistance: DEDUP_RADIUS_METERS
                    }
                }
            }).limit(1);

            if (nearbyTickets.length > 0) {
                matchingTicket = nearbyTickets[0];
            }
        } catch (geoErr) {
            console.warn('[Dedup] Geo query failed:', geoErr.message);
        }
    }

    if (matchingTicket) {
        matchingTicket.complaintCount += 1;
        matchingTicket.severity = severity || calculateSeverity(matchingTicket.complaintCount);
        if (!matchingTicket.department && department) matchingTicket.department = department;
        // Append citizen images to existing ticket
        if (citizenImages && citizenImages.length > 0) {
            matchingTicket.citizenImages.push(...citizenImages);
        }
        matchingTicket.actionHistory.push({
            newStatus: matchingTicket.status,
            remarks: `Additional complaint linked (total: ${matchingTicket.complaintCount})`,
            progressPercentage: matchingTicket.progressPercent
        });
        await matchingTicket.save();
    } else {
        isNew = true;

        // Auto-classify level from top 100 problems
        const classification = classifyProblemLevel(category, subCategory);
        const ticketLevel = classification.level;
        const ticketSeverity = severity || classification.severity || 'Low';
        const ticketDept = department || classification.department || null;

        // Level 1 = auto-approved, Level 2+ = pending approval
        const autoApproved = ticketLevel === 1;

        matchingTicket = new MasterTicket({
            primaryCategory: category,
            subCategory: subCategory || '',
            description: description,
            severity: ticketSeverity,
            level: ticketLevel,
            isApproved: autoApproved ? true : null, // null = pending
            complaintCount: 1,
            status: autoApproved ? 'Open' : 'Registered',
            department: ticketDept,
            needsManualGeo: !hasLocation,
            landmark: landmark || "",
            city: user?.city || data.city || "",
            zone: zone || "",
            wardNumber: wardNumber || "",
            locality: locality || "",
            pincode: pincode || "",
            citizenImages: citizenImages || [],
            audioUrl: audioUrl || null,
            source: source || 'web_form',
            isAnonymous: isAnonymous || false,
            complainantId: user?._id || null,
            complainantName: isAnonymous ? 'Anonymous' : (user?.name || data.complainantName || 'Citizen'),
            complainantPhone: user?.phone || data.complainantPhone || '',
            complainantEmail: user?.email || data.complainantEmail || '',
            location: hasLocation ? { type: "Point", coordinates: [Number(lng), Number(lat)] } : undefined,
            slaDeadline: calculateSlaDeadline(ticketDept),
            actionHistory: [{
                newStatus: autoApproved ? 'Open' : 'Registered',
                remarks: `Complaint registered via ${source || 'web_form'} — Level ${ticketLevel} ${autoApproved ? '(auto-approved)' : '(pending approval)'}`,
                progressPercentage: 0
            }]
        });
        await matchingTicket.save();

        // Level 1 → auto-assign to junior with fewest active tickets
        if (autoApproved && ticketDept) {
            const assignee = await autoAssignJunior(ticketDept, user?.city || data.city);
            if (assignee) {
                matchingTicket.assignedJuniorId = assignee._id;
                matchingTicket.assignedEngineerId = assignee._id;
                matchingTicket.status = 'Assigned';
                matchingTicket.actionHistory.push({
                    newStatus: 'Assigned',
                    remarks: `Auto-assigned to ${assignee.name} (fewest active tickets)`,
                    progressPercentage: 0
                });
                await matchingTicket.save();
            }
        }
    }

    // Save raw complaint
    const complaint = new RawComplaint({
        userId: user?._id || undefined,
        callerPhone: callerPhone || '',
        callerPhoneRaw: callerPhoneRaw || '',
        audioUrl: audioUrl || undefined,
        transcriptOriginal: transcriptOriginal || description,
        transcriptEnglish: transcriptEnglish || description,
        intentCategory: category,
        extractedLandmark: landmark || '',
        location: hasLocation ? { type: "Point", coordinates: [Number(lng), Number(lat)] } : undefined,
        geoAccuracy: accuracy,
        department: department,
        source: source || 'web_form',
        status: matchingTicket.status,
        masterTicketId: matchingTicket._id
    });
  await complaint.save();

  // Auto-create implementation plan for new tickets
  if (isNew && matchingTicket.level) {
    try {
      const ImplementationPlan = require('../models/ImplementationPlan');
      
      const existingPlan = await ImplementationPlan.findOne({ masterTicketId: matchingTicket._id });
      if (!existingPlan) {
        // Try SOP-based plan generation first (backend_portable)
        const { generatePlanFromSOP, checkSOPServiceHealth } = require('../services/sopPlanGenerator');
        
        const sopHealth = await checkSOPServiceHealth();
        let planData = null;
        
        if (sopHealth.running) {
          console.log(`[Auto-Plan] SOP service running, generating plan for ${matchingTicket.primaryCategory}...`);
          const sopResult = await generatePlanFromSOP(matchingTicket);
          
          if (sopResult.success) {
            planData = sopResult.plan;
            console.log(`[Auto-Plan] SOP plan generated successfully for ${matchingTicket.ticketNumber}`);
          } else {
            console.warn(`[Auto-Plan] SOP generation failed: ${sopResult.error}, using fallback template`);
          }
        } else {
          console.log(`[Auto-Plan] SOP service not running (${sopHealth.error || 'not available'}), using fallback template`);
        }
        
        // If SOP failed or not available, use fallback template
        if (!planData) {
          const { getPlanTemplate } = require('../data/implementationPlans');
          const template = getPlanTemplate(matchingTicket.primaryCategory);
          
          planData = {
            masterTicketId: matchingTicket._id,
            ticketNumber: matchingTicket.ticketNumber,
            category: matchingTicket.primaryCategory,
            subCategory: matchingTicket.subCategory || '',
            level: matchingTicket.level,
            severity: matchingTicket.severity,
            department: matchingTicket.department,
            zone: matchingTicket.zone || '',
            wardNumber: matchingTicket.wardNumber || '',
            locality: matchingTicket.locality || '',
            landmark: matchingTicket.landmark || '',
            title: template.title,
            description: template.description,
            problemAnalysis: template.problemAnalysis,
            steps: template.steps.map(step => ({
              ...step,
              status: 'pending',
              beforePhotos: [],
              duringPhotos: [],
              afterPhotos: [],
              juniorRemarks: '',
              seniorRemarks: ''
            })),
            totalEstimatedHours: template.estimatedHours,
            totalEstimatedCost: template.materials?.reduce((sum, m) => sum + (m.estimatedCost || 0), 0) || 0,
            primaryMaterials: template.materials || [],
            primaryEquipment: template.equipment || [],
            currentStage: 'ai_generated',
            status: 'draft',
            aiGeneratedAt: new Date(),
            aiGeneratedBy: 'CivicSync AI (Template)',
            approvalHistory: [{
              action: 'ai_generated',
              performedBy: null,
              performedByRole: 'ai',
              remarks: `Implementation plan for ${matchingTicket.primaryCategory} complaint (Level ${matchingTicket.level})`,
              timestamp: new Date()
            }]
          };
        }
        
        const plan = new ImplementationPlan(planData);
        await plan.save();
        matchingTicket.implementationPlanId = plan._id;
        await matchingTicket.save();
        
        console.log(`[Auto-Plan] Created implementation plan for ticket ${matchingTicket.ticketNumber} (Level ${matchingTicket.level})`);
      }
    } catch (planErr) {
      console.warn('[Auto-Plan] Failed to create implementation plan:', planErr.message);
    }
  }

  return { ticket: matchingTicket, rawComplaint: complaint, isNew };
}

// Export for use in voice.js
router.createComplaintFromData = createComplaintFromData;

// ─── POST /api/tickets/complaint ─── Submit a new complaint (web form)
router.post('/complaint', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user && user.isBanned) {
      return res.status(403).json({ 
        message: 'Your account has been banned due to: ' + (user.banReason || 'Policy violation'),
        isBanned: true
      });
    }

    const { category, primaryCategory, subCategory, description, landmark,
      lat, lng, accuracy, department,
      zone, wardNumber, locality, pincode,
      citizenImages, isAnonymous } = req.body;

    const result = await createComplaintFromData({
      primaryCategory: primaryCategory || category,
      subCategory, description, landmark,
      lat, lng, accuracy, department,
      zone, wardNumber, locality, pincode,
      citizenImages, isAnonymous,
      source: 'web_form'
    }, req.user);

    res.status(201).json({
      ticketId: result.ticket._id,
      isNew: result.isNew,
      ticket: formatTicket(result.ticket),
      needsManualGeo: result.ticket.needsManualGeo
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

        console.log(`[MyComplaints] User ${req.user._id}: found ${complaints.length} total complaints | sources: ${[...new Set(complaints.map(c => c.source))].join(', ')}`);

        const ticketIds = [...new Set(
            complaints
                .map(c => c.masterTicketId)
                .filter(id => id && mongoose.Types.ObjectId.isValid(id))
                .map(id => id.toString())
        )];

        const tickets = ticketIds.length
            ? await MasterTicket.find({ _id: { $in: ticketIds } })
                .populate('assignedJuniorId', 'name phone department role')
                .populate('assignedEngineerId', 'name phone department role')
                .populate('approvedBy', 'name department role')
                .lean().maxTimeMS(10000)
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

        const maxDistance = parseInt(radius, 10) || 5000;

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
        const userRole = req.user.role;
        const userCity = (req.user.city || '').trim();
        const userDistrict = (req.user.district || '').trim();

        // Location filtering (case-insensitive to prevent mismatch between citizen/officer city values)
        if (req.user.mode === 'rural' && userDistrict) {
            query.city = { $regex: userDistrict, $options: 'i' };
        } else if (userCity) {
            query.city = { $regex: `^${userCity}$`, $options: 'i' };
        }
        // If no city set, officer/admin sees ALL tickets (no empty result)

        // Role-based filtering
        if (['junior', 'engineer'].includes(userRole) && req.user.department) {
            query.department = req.user.department;
            // Show ALL department tickets so junior can see full workload
            // Frontend separates "My Tickets" (assigned to me) from "Other" client-side
            query.status = { $ne: 'Closed' };
        } else if (userRole === 'dept_head' && req.user.department) {
            query.department = req.user.department;
        } else if (req.query.needsManualGeo === 'true') {
            query.needsManualGeo = true;
            query.status = { $nin: ['Closed', 'Invalid_Spam'] };
        }

        const tickets = await MasterTicket.find(query)
            .populate('assignedEngineerId', 'name email phone department')
            .populate('assignedJuniorId', 'name email phone department')
            .sort({ updatedAt: -1 });

        res.json(tickets.map(formatTicket));
    } catch (err) {
        console.error('[Master Tickets Error]', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── GET /api/tickets/master/:id ─── Single ticket detail (with transparency)
router.get('/master/:id', protect, async (req, res) => {
    try {
        const ticket = await MasterTicket.findById(req.params.id)
            .populate('assignedEngineerId', 'name phone department role')
            .populate('assignedJuniorId', 'name phone department role')
            .populate('approvedBy', 'name phone department role')
            .populate('mergedTicketIds', 'ticketNumber status');
        if (!ticket) return res.status(404).json({ message: "Ticket not found" });

        // Populate actionHistory.updatedBy for timeline transparency
        const ticketObj = ticket.toObject();
        if (ticketObj.actionHistory && ticketObj.actionHistory.length > 0) {
            const userIds = [...new Set(
                ticketObj.actionHistory
                    .map(a => a.updatedBy)
                    .filter(id => id && mongoose.Types.ObjectId.isValid(id))
                    .map(id => id.toString())
            )];
            if (userIds.length > 0) {
                const users = await User.find({ _id: { $in: userIds } })
                    .select('name role department').lean();
                const userMap = new Map(users.map(u => [u._id.toString(), u]));
                ticketObj.actionHistory = ticketObj.actionHistory.map(a => ({
                    ...a,
                    updatedByUser: a.updatedBy ? userMap.get(a.updatedBy.toString()) || null : null
                }));
            }
        }

        res.json({
            ...ticketObj, id: ticketObj._id,
            lat: ticketObj.location ? ticketObj.location.coordinates[1] : null,
            lng: ticketObj.location ? ticketObj.location.coordinates[0] : null,
        });
    } catch (err) {
        console.error('[Ticket Detail Error]', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── PUT /api/tickets/master/:id ─── Update ticket (officer/dept_head/junior)
router.put('/master/:id', protect, authorize('officer', 'dept_head', 'junior', 'admin', 'engineer'), async (req, res) => {
    try {
        const ticket = await MasterTicket.findById(req.params.id);
        if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

        const isOfficer = ['officer', 'admin'].includes(req.user.role);
        const isDeptHead = req.user.role === 'dept_head';
        const isJunior = ['junior', 'engineer'].includes(req.user.role);
        const isAssignedJunior = (ticket.assignedJuniorId && ticket.assignedJuniorId.toString() === req.user._id.toString()) ||
            (ticket.assignedEngineerId && ticket.assignedEngineerId.toString() === req.user._id.toString());
        const isEligibleUnassignedJunior = !ticket.assignedJuniorId && !ticket.assignedEngineerId && req.user.department && ticket.department === req.user.department;

        if (isJunior && !isAssignedJunior && !isEligibleUnassignedJunior) {
            return res.status(403).json({ message: 'You can only update assigned or own-department unassigned tickets' });
        }

        if (isJunior) {
            const restrictedFields = ['status', 'assignedEngineerId', 'assignedJuniorId', 'needsManualGeo', 'severity', 'complaintCount', 'department', 'city', 'lat', 'lng'];
            const attemptedRestrictedField = restrictedFields.some((field) => req.body[field] !== undefined);
            if (attemptedRestrictedField) {
                return res.status(403).json({ message: 'Junior officials are not allowed to modify restricted fields' });
            }
        }

        const previousStatus = ticket.status;

        // Dynamic field updates
        const allowedFields = ['status', 'assignedEngineerId', 'assignedJuniorId', 'needsManualGeo', 'resolutionRemarks', 'severity', 'complaintCount', 'department', 'landmark', 'city', 'progressPercent', 'currentPhase', 'zone', 'wardNumber', 'locality', 'pincode'];
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                if (isJunior && !['progressPercent', 'currentPhase', 'resolutionRemarks', 'juniorRemarks'].includes(field)) return;
                if ((field === 'assignedEngineerId' || field === 'assignedJuniorId') && !req.body[field]) {
                    ticket[field] = null;
                } else {
                    ticket[field] = req.body[field];
                    // Keep both fields in sync
                    if (field === 'assignedJuniorId') ticket.assignedEngineerId = req.body[field];
                    if (field === 'assignedEngineerId') ticket.assignedJuniorId = req.body[field];
                }
            }
        });

        if (isJunior && req.body.progressPercent !== undefined && Number(req.body.progressPercent) < 100) {
            ticket.status = 'In_Progress';
        }

        // Update phases when progress changes
        if (req.body.progressPercent !== undefined) {
            // Auto-calculate phase if not explicitly provided
            const targetPhase = req.body.currentPhase || calculatePhase(req.body.progressPercent);
            
            if (ticket.phases && ticket.phases.length > 0) {
                const phaseIndex = targetPhase - 1;
                if (phaseIndex >= 0 && phaseIndex < ticket.phases.length) {
                    ticket.phases[phaseIndex].status = 'completed';
                    ticket.phases[phaseIndex].completedAt = new Date();
                    ticket.phases[phaseIndex].updatedBy = req.user._id;
                    
                    // Mark next phase as in_progress
                    if (phaseIndex + 1 < ticket.phases.length) {
                        ticket.phases[phaseIndex + 1].status = 'in_progress';
                        ticket.phases[phaseIndex + 1].startedAt = new Date();
                    }
                }
                ticket.currentPhase = targetPhase;
            }
        } else if (req.body.currentPhase && ticket.phases) {
            // Only currentPhase provided, update phases
            const phaseIndex = req.body.currentPhase - 1;
            if (phaseIndex >= 0 && phaseIndex < ticket.phases.length) {
                ticket.phases[phaseIndex].status = 'completed';
                ticket.phases[phaseIndex].completedAt = new Date();
                ticket.phases[phaseIndex].updatedBy = req.user._id;
                
                if (phaseIndex + 1 < ticket.phases.length) {
                    ticket.phases[phaseIndex + 1].status = 'in_progress';
                    ticket.phases[phaseIndex + 1].startedAt = new Date();
                }
            }
            ticket.currentPhase = req.body.currentPhase;
        }

        // Manual coordinate fix from Officer/DeptHead
        if ((isOfficer || isDeptHead) && hasGeoCoordinates(req.body.lat, req.body.lng)) {
            ticket.location = { type: 'Point', coordinates: [Number(req.body.lng), Number(req.body.lat)] };
        }

        // Update junior's lastActiveDate when they update a ticket
        if (isJunior) {
            req.user.lastActiveDate = new Date();
            await req.user.save();
        }

        // Engineer resolution submission (full completion)
        if (hasGeoCoordinates(req.body.resolutionLat, req.body.resolutionLng)) {
            ticket.resolutionLocation = { type: 'Point', coordinates: [Number(req.body.resolutionLng), Number(req.body.resolutionLat)] };
            if (req.body.resolutionImageUrl) {
                ticket.resolutionImages.push(req.body.resolutionImageUrl);
            }
            if (req.body.resolutionImages && Array.isArray(req.body.resolutionImages)) {
                ticket.resolutionImages.push(...req.body.resolutionImages);
            }
            ticket.resolutionRemarks = req.body.resolutionRemarks || req.body.resolutionNotes || '';
            ticket.resolvedAt = new Date();
            ticket.status = 'Pending_Verification';
        }

        // Progress update with photo (at ANY progress level, not just 100%)
        const remarks = req.body.juniorRemarks || req.body.resolutionRemarks || req.body.resolutionNotes || req.body.remarks || '';
        const progressImages = req.body.progressImage ? [req.body.progressImage] : [];

        // Push to actionHistory on every update
        ticket.actionHistory.push({
            updatedBy: req.user._id,
            previousStatus: previousStatus,
            newStatus: ticket.status,
            remarks: remarks || `Progress: ${ticket.progressPercent}%`,
            progressPercentage: ticket.progressPercent,
            images: progressImages.length > 0 ? progressImages :
                (req.body.resolutionImageUrl ? [req.body.resolutionImageUrl] : [])
        });

        // Update last progress timestamp
        ticket.lastProgressUpdate = new Date();

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
        const previousStatus = ticket.status;

        if (verified) {
            ticket.status = 'Closed';
            ticket.reComplaintRemark = '';
            ticket.isReopened = false;
        } else {
            // Re-complaint: reopen for engineer
            ticket.status = 'Reopened';
            ticket.reComplaintRemark = feedback || '';
            ticket.progressPercent = 0;
            ticket.resolutionImages = [];
            ticket.resolutionLocation = null;
            ticket.resolutionRemarks = '';
            ticket.resolvedAt = null;
            ticket.isReopened = true;
        }

        if (rating !== undefined) ticket.citizenRating = rating;
        if (feedback !== undefined) ticket.citizenFeedbackText = feedback;

        ticket.actionHistory.push({
            updatedBy: req.user._id,
            previousStatus: previousStatus,
            newStatus: ticket.status,
            remarks: verified ? 'Citizen satisfied — ticket closed' : `Re-complaint: ${feedback || 'No remark'}`,
            progressPercentage: verified ? 100 : 0
        });

        await ticket.save();
        res.json(formatTicket(ticket));
    } catch (err) {
        console.error('[Ticket Verify Error]', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── POST /api/tickets/master/:id/upvote ─── Citizen upvote with proof
router.post('/master/:id/upvote', protect, authorize('user'), async (req, res) => {
    try {
        const ticket = await MasterTicket.findById(req.params.id);
        if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

        const { proofImageUrl } = req.body;
        if (!proofImageUrl) {
            return res.status(400).json({ message: 'Proof image is required to upvote' });
        }

        ticket.complaintCount += 1;
        ticket.severity = calculateSeverity(ticket.complaintCount);
        ticket.citizenImages.push(proofImageUrl);

        ticket.actionHistory.push({
            newStatus: ticket.status,
            remarks: `Upvote #${ticket.complaintCount} with proof image`,
            progressPercentage: ticket.progressPercent
        });

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

// ─── GET /api/tickets/stats ─── Dashboard stats (officer/dept_head)
router.get('/stats', protect, authorize('officer', 'dept_head', 'admin'), async (req, res) => {
    try {
        const baseQuery = {};
        const userCity = (req.user.city || '').trim();
        if (userCity) baseQuery.city = userCity;

        // dept_head sees only their department
        if (req.user.role === 'dept_head' && req.user.department) {
            baseQuery.department = req.user.department;
        }

        const [total, open, critical, pendingGeo] = await Promise.all([
            MasterTicket.countDocuments(baseQuery),
            MasterTicket.countDocuments({ ...baseQuery, status: { $nin: ['Closed', 'Invalid_Spam'] } }),
            MasterTicket.countDocuments({ ...baseQuery, severity: 'Critical', status: { $nin: ['Closed'] } }),
            MasterTicket.countDocuments({ ...baseQuery, needsManualGeo: true, status: { $nin: ['Closed'] } })
        ]);
        res.json({ total, open, critical, pendingGeo });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─── GET /api/tickets/pending-approval ─── Pending Level 2+ tickets, sorted by priority
router.get('/pending-approval', protect, authorize('officer', 'dept_head', 'admin'), async (req, res) => {
    try {
        const query = { isApproved: null, status: 'Registered' };
        const userCity = (req.user.city || '').trim();
        if (userCity) query.city = userCity;

        // Dept head sees only their department
        if (req.user.role === 'dept_head' && req.user.department) {
            query.department = req.user.department;
            query.level = 2; // dept_head can only approve L2
        }

        // Sort by complaintCount descending = highest priority first
        const tickets = await MasterTicket.find(query)
            .sort({ complaintCount: -1, severity: -1, createdAt: 1 })
            .populate('complainantId', 'name phone');

        res.json(tickets.map(formatTicket));
    } catch (err) {
        console.error('[Pending Approval Error]', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── GET /api/tickets/master/:id/suggest-assignee ─── Suggest juniors for assignment
router.get('/master/:id/suggest-assignee', protect, authorize('officer', 'dept_head', 'admin'), async (req, res) => {
    try {
        const ticket = await MasterTicket.findById(req.params.id);
        if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

        // Find all juniors in same department + city
        const juniorQuery = {
            role: { $in: ['junior', 'engineer'] },
            active: true,
        };
        if (ticket.department) juniorQuery.department = ticket.department;
        if (ticket.city) juniorQuery.city = { $regex: ticket.city, $options: 'i' };

        const juniors = await User.find(juniorQuery)
            .select('_id name phone department city performancePoints').lean();

        if (juniors.length === 0) {
            return res.json({ suggestion: null, juniors: [], message: 'No juniors available in this department' });
        }

        // Count active tickets per junior
        const ranked = await Promise.all(
            juniors.map(async (j) => {
                const activeTickets = await MasterTicket.countDocuments({
                    $or: [{ assignedJuniorId: j._id }, { assignedEngineerId: j._id }],
                    status: { $nin: ['Closed', 'Rejected', 'Invalid_Spam'] }
                });
                return { ...j, activeTickets };
            })
        );

        // Sort by fewest active tickets, then highest performance points
        ranked.sort((a, b) => a.activeTickets - b.activeTickets || b.performancePoints - a.performancePoints);

        res.json({
            suggestion: ranked[0], // The recommended assignee
            juniors: ranked,       // Full ranked list for manual override
        });
    } catch (err) {
        console.error('[Suggest Assignee Error]', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── PUT /api/tickets/master/:id/approve ─── Senior approves Level 2+ tickets
// Accepts optional `assignToJuniorId` for manual override; otherwise uses suggestion
router.put('/master/:id/approve', protect, authorize('officer', 'dept_head', 'admin'), async (req, res) => {
    try {
        const ticket = await MasterTicket.findById(req.params.id);
        if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

        if (ticket.isApproved === true) {
            return res.status(400).json({ message: 'Ticket is already approved' });
        }

        // Dept head can only approve Level 2, officer can approve any
        const isOfficer = ['officer', 'admin'].includes(req.user.role);
        if (!isOfficer && ticket.level > 2) {
            return res.status(403).json({ message: 'Only officers can approve Level 3+ tickets' });
        }

        const previousStatus = ticket.status;
        ticket.isApproved = true;
        ticket.approvedBy = req.user._id;
        ticket.status = 'Open';

        ticket.actionHistory.push({
            updatedBy: req.user._id,
            previousStatus,
            newStatus: 'Open',
            remarks: `Approved by ${req.user.name} (Level ${ticket.level} ticket)`,
            progressPercentage: 0
        });

        await ticket.save();

        // Assignment: manual override or auto-suggestion
        const { assignToJuniorId } = req.body;

        if (assignToJuniorId) {
            // Manual assignment by senior officer
            const junior = await User.findById(assignToJuniorId).select('name');
            if (junior) {
                ticket.assignedJuniorId = junior._id;
                ticket.assignedEngineerId = junior._id;
                ticket.status = 'Assigned';
                ticket.actionHistory.push({
                    updatedBy: req.user._id,
                    previousStatus: 'Open',
                    newStatus: 'Assigned',
                    remarks: `Manually assigned to ${junior.name} by ${req.user.name}`,
                    progressPercentage: 0
                });
                await ticket.save();
            }
        } else if (ticket.department) {
            // Auto-suggest: assign to junior with fewest tickets
            const assignee = await autoAssignJunior(ticket.department, ticket.city);
            if (assignee) {
                ticket.assignedJuniorId = assignee._id;
                ticket.assignedEngineerId = assignee._id;
                ticket.status = 'Assigned';
                ticket.actionHistory.push({
                    updatedBy: req.user._id,
                    previousStatus: 'Open',
                    newStatus: 'Assigned',
                    remarks: `Auto-assigned to ${assignee.name} (fewest active tickets — suggested by system)`,
                    progressPercentage: 0
                });
                await ticket.save();
            }
        }

        const result = await MasterTicket.findById(ticket._id)
            .populate('assignedJuniorId', 'name phone department')
            .populate('approvedBy', 'name phone department');
        res.json(formatTicket(result));
    } catch (err) {
        console.error('[Ticket Approve Error]', err);
        res.status(500).json({ message: err.message });
    }
});

// ─── PUT /api/tickets/master/:id/merge ─── Merge duplicate tickets
router.put('/master/:id/merge', protect, authorize('officer', 'dept_head', 'admin'), async (req, res) => {
    try {
        const { targetTicketId } = req.body;
        if (!targetTicketId) return res.status(400).json({ message: 'targetTicketId is required' });

        const sourceTicket = await MasterTicket.findById(req.params.id);
        const targetTicket = await MasterTicket.findById(targetTicketId);

        if (!sourceTicket) return res.status(404).json({ message: 'Source ticket not found' });
        if (!targetTicket) return res.status(404).json({ message: 'Target ticket not found' });
        if (sourceTicket._id.toString() === targetTicket._id.toString()) {
            return res.status(400).json({ message: 'Cannot merge a ticket into itself' });
        }

        // Move complaints from source → target
        await RawComplaint.updateMany(
            { masterTicketId: sourceTicket._id },
            { $set: { masterTicketId: targetTicket._id } }
        );

        // Update target ticket
        targetTicket.complaintCount += sourceTicket.complaintCount;
        targetTicket.severity = calculateSeverity(targetTicket.complaintCount);
        if (sourceTicket.citizenImages.length > 0) {
            targetTicket.citizenImages.push(...sourceTicket.citizenImages);
        }
        if (!targetTicket.mergedTicketIds) targetTicket.mergedTicketIds = [];
        targetTicket.mergedTicketIds.push(sourceTicket._id);
        targetTicket.actionHistory.push({
            updatedBy: req.user._id,
            previousStatus: targetTicket.status,
            newStatus: targetTicket.status,
            remarks: `Merged ticket ${sourceTicket.ticketNumber} into this ticket (${sourceTicket.complaintCount} complaints absorbed)`,
            progressPercentage: targetTicket.progressPercent
        });
        await targetTicket.save();

        // Close source ticket
        sourceTicket.status = 'Closed';
        sourceTicket.actionHistory.push({
            updatedBy: req.user._id,
            previousStatus: sourceTicket.status,
            newStatus: 'Closed',
            remarks: `Merged into ticket ${targetTicket.ticketNumber}`,
            progressPercentage: 100
        });
        await sourceTicket.save();

        res.json({
            message: `Merged ${sourceTicket.ticketNumber} → ${targetTicket.ticketNumber}`,
            sourceTicket: formatTicket(sourceTicket),
            targetTicket: formatTicket(targetTicket)
        });
    } catch (err) {
        console.error('[Ticket Merge Error]', err);
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
