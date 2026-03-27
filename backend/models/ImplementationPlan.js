const mongoose = require('mongoose');

// Implementation Step Schema - individual steps in the plan
const implementationStepSchema = new mongoose.Schema({
  stepNumber: { type: Number, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  estimatedHours: { type: Number, default: 24 },
  estimatedCost: { type: Number, default: 0 },
  requiredMaterials: [{ type: String }],
  requiredEquipment: [{ type: String }],
  requiredPersonnel: [{ type: String }],
  safetyPrecautions: [{ type: String }],
  
  // Progress tracking
  status: { 
    type: String, 
    enum: ['pending', 'in_progress', 'completed', 'verified', 'rejected'], 
    default: 'pending' 
  },
  startedAt: { type: Date },
  completedAt: { type: Date },
  verifiedAt: { type: Date },
  
  // Photo evidence
  beforePhotos: [{ type: String }],
  duringPhotos: [{ type: String }],
  afterPhotos: [{ type: String }],
  
  // Junior Engineer remarks
  juniorRemarks: { type: String, default: '' },
  juniorEditedAt: { type: Date },
  juniorEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // Senior Engineer verification
  seniorRemarks: { type: String, default: '' },
  seniorVerifiedAt: { type: Date },
  seniorVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { _id: true });

// Approval History Schema - tracks the approval chain
const approvalHistorySchema = new mongoose.Schema({
  action: { 
    type: String, 
    enum: ['ai_generated', 'junior_reviewed', 'senior_reviewed', 'approved', 'rejected', 'sent_back', 'work_started', 'progress_updated', 'work_completed', 'verified', 'forwarded', 'comment_added', 'field_updated', 'step_completed', 'step_verified', 'step_rejected', 'send_back', 'level1_approved', 'level2_approved'],
    required: true 
  },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  performedByRole: { type: String, enum: ['ai', 'junior', 'engineer', 'senior_engineer', 'dept_head', 'officer', 'admin', 'citizen', 'user'] },
  remarks: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now },
  
  // What changed in this action
  changes: {
    stepsModified: [{ type: Number }],
    fieldsModified: [{ type: String }],
    previousStatus: { type: String },
    newStatus: { type: String }
  }
}, { _id: true });

// Main Implementation Plan Schema
const implementationPlanSchema = new mongoose.Schema({
  // Link to Master Ticket
  masterTicketId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'MasterTicket', 
    required: true,
    index: true 
  },
  ticketNumber: { type: String, required: true },
  
  // Problem Classification
  category: { type: String, required: true },
  subCategory: { type: String, default: '' },
  level: { type: Number, enum: [1, 2, 3, 4], required: true },
  severity: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], default: 'Low' },
  department: { type: String, required: true },
  
  // Location Context
  zone: { type: String, default: '' },
  wardNumber: { type: String, default: '' },
  locality: { type: String, default: '' },
  landmark: { type: String, default: '' },
  
  // Implementation Plan Content
  title: { type: String, required: true },
  description: { type: String, required: true },
  problemAnalysis: { type: String, required: true },
  
  // Steps breakdown
  steps: [implementationStepSchema],
  
  // Overall estimates
  totalEstimatedHours: { type: Number, default: 0 },
  totalEstimatedCost: { type: Number, default: 0 },
  
  // Resources
  primaryMaterials: [{ 
    name: { type: String },
    quantity: { type: String },
    estimatedCost: { type: Number }
  }],
  primaryEquipment: [{ type: String }],
  
  // Approval Chain Status
  currentStage: {
    type: String,
    enum: ['ai_generated', 'pending_junior_review', 'pending_senior_review', 'approved', 'in_progress', 'completed', 'verified'],
    default: 'ai_generated'
  },
  
  // Who has approved/edited
  aiGeneratedAt: { type: Date, default: Date.now },
  aiGeneratedBy: { type: String, default: 'CivicSync AI' },
  
  juniorReviewedAt: { type: Date },
  juniorReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  juniorEditCount: { type: Number, default: 0 },
  
  seniorReviewedAt: { type: Date },
  seniorReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  seniorEditCount: { type: Number, default: 0 },
  
  approvedAt: { type: Date },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // For Level 1 - direct approval
  directApproved: { type: Boolean, default: false },
  
  // Progress tracking
  overallProgress: { type: Number, default: 0, min: 0, max: 100 },
  workStartedAt: { type: Date },
  workCompletedAt: { type: Date },
  
  // Citizen visibility
  isVisibleToCitizens: { type: Boolean, default: false },
  visibleFrom: { type: Date },
  
  // Approval History Trail
  approvalHistory: [approvalHistorySchema],
  
  // Comments from different roles
  comments: [{
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    authorRole: { type: String },
    authorName: { type: String },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    isInternal: { type: Boolean, default: false }
  }],
  
  // Status
  status: {
    type: String,
    enum: ['draft', 'pending_review', 'under_review', 'approved', 'rejected', 'in_progress', 'completed', 'verified', 'archived'],
    default: 'draft'
  },
  
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Indexes
implementationPlanSchema.index({ masterTicketId: 1 });
implementationPlanSchema.index({ ticketNumber: 1 });
implementationPlanSchema.index({ department: 1, status: 1 });
implementationPlanSchema.index({ level: 1, currentStage: 1 });

// Method to check if plan can be edited by role
implementationPlanSchema.methods.canEdit = function(userRole) {
  if (this.status === 'archived') return false;
  
  if (userRole === 'junior' || userRole === 'engineer') {
    return ['ai_generated', 'pending_junior_review', 'pending_senior_review'].includes(this.currentStage);
  }
  
  if (userRole === 'senior_engineer' || userRole === 'dept_head' || userRole === 'officer') {
    return ['ai_generated', 'pending_junior_review', 'pending_senior_review'].includes(this.currentStage);
  }
  
  return false;
};

// Method to add approval history entry
implementationPlanSchema.methods.addHistory = function(action, user, remarks, changes = {}) {
  this.approvalHistory.push({
    action,
    performedBy: user?._id || null,
    performedByRole: user?.role || 'ai',
    remarks,
    timestamp: new Date(),
    changes
  });
};

const ImplementationPlan = mongoose.model('ImplementationPlan', implementationPlanSchema);

module.exports = ImplementationPlan;
