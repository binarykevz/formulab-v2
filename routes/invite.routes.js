const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { authenticate, requireDepartment } = require('../middleware/auth');
const { tenantIsolation } = require('../middleware/tenant');
const accountsDb = require('../db/accounts');
const emailService = require('../services/email.service');

router.use(authenticate, tenantIsolation);

router.post('/', async (req,res) => {
  const {email,department} = req.body;
  const token = crypto.randomBytes(32).toString('hex');
  await accountsDb.db.execute({sql:'INSERT INTO invites(id,org_id,email,department,token,invited_by,invited_by_name,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)',args:[crypto.randomUUID(),req.orgId,email,department,token,req.user.id,req.user.name,Date.now()+604800000,Date.now()]});
  emailService.sendInviteEmail({email,orgName:req.orgName,department,acceptLink:`${process.env.FRONTEND_URL}/accept-invite.html?token=${token}`});
  res.json({message:'Invite sent'});
});

router.get('/', async (req,res) => {
  const r = await accountsDb.db.execute({sql:'SELECT * FROM invites WHERE org_id=? ORDER BY created_at DESC',args:[req.orgId]});
  res.json({invites:r.rows});
});

module.exports = router;