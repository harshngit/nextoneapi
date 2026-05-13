/**
 * emailServiceAdditions.js — Nextone Reality
 * Additional email notification functions for lead reassignment
 * 
 * ADD THESE FUNCTIONS TO YOUR EXISTING src/utils/emailService.js
 */

/**
 * Notify user when a lead is reassigned away from them
 * @param {Object} params - Notification parameters
 */
const notifyLeadReassigned = async ({
  lead,
  oldAssigneeName,
  oldAssigneeEmail,
  newAssigneeName,
  performedBy,
  reason,
}) => {
  const subject = `Lead Reassigned: ${lead.name}`;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #0066CC;">Lead Reassignment Notification</h2>
      
      <p>Hello ${oldAssigneeName},</p>
      
      <p>The following lead has been reassigned from you:</p>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Lead Name:</strong> ${lead.name}</p>
        <p><strong>Phone:</strong> ${lead.phone}</p>
        <p><strong>New Assignee:</strong> ${newAssigneeName}</p>
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
        <p><strong>Performed By:</strong> ${performedBy}</p>
      </div>
      
      <p>If you have any questions about this reassignment, please contact your manager.</p>
      
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
      <p style="color: #666; font-size: 12px;">
        This is an automated notification from Next One Realty CRM.
      </p>
    </div>
  `;
  
  const text = `
Lead Reassignment Notification

Hello ${oldAssigneeName},

The following lead has been reassigned from you:

Lead Name: ${lead.name}
Phone: ${lead.phone}
New Assignee: ${newAssigneeName}
${reason ? `Reason: ${reason}` : ''}
Performed By: ${performedBy}

If you have any questions about this reassignment, please contact your manager.
  `;
  
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'noreply@nextonerealty.com',
    to: oldAssigneeEmail,
    subject,
    text,
    html,
  });
};

/**
 * Notify user when multiple leads are assigned to them (bulk assignment)
 * @param {Object} params - Notification parameters
 */
const notifyBulkLeadsAssigned = async ({
  assigneeName,
  assigneeEmail,
  leadsCount,
  performedBy,
  reason,
}) => {
  const subject = `${leadsCount} Leads Assigned to You`;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #0066CC;">Bulk Lead Assignment</h2>
      
      <p>Hello ${assigneeName},</p>
      
      <p><strong>${leadsCount} leads</strong> have been assigned to you.</p>
      
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Total Leads:</strong> ${leadsCount}</p>
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
        <p><strong>Assigned By:</strong> ${performedBy}</p>
      </div>
      
      <p>Please log in to your CRM dashboard to view and manage these leads.</p>
      
      <div style="margin: 30px 0;">
        <a href="${process.env.FRONTEND_URL || 'https://crm.nextonerealty.com'}/leads" 
           style="background-color: #0066CC; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
          View My Leads
        </a>
      </div>
      
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
      <p style="color: #666; font-size: 12px;">
        This is an automated notification from Next One Realty CRM.
      </p>
    </div>
  `;
  
  const text = `
Bulk Lead Assignment

Hello ${assigneeName},

${leadsCount} leads have been assigned to you.

Total Leads: ${leadsCount}
${reason ? `Reason: ${reason}` : ''}
Assigned By: ${performedBy}

Please log in to your CRM dashboard to view and manage these leads.
  `;
  
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'noreply@nextonerealty.com',
    to: assigneeEmail,
    subject,
    text,
    html,
  });
};

// Export these functions
module.exports = {
  // ... your existing exports
  notifyLeadReassigned,
  notifyBulkLeadsAssigned,
};