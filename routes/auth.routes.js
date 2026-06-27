const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const accountsDb = require('../db/accounts');
const { logRegistration, logAudit } = require('../db/audit');
const { audit } = require('../middleware/audit');
const emailService = require('../services/email.service');
const telegram = require('../services/telegram.service');

const genId = () => crypto.randomUUID();
const genSlug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g,'-');

router.post('/register', audit('REGISTER','user'), async (req,res) => {
  try {
    const {name,username,email,organization,department,password} = req.body;
    if(!name||!username||!email||!organization||!department||!password) return res.status(400).json({error:'All fields required'});
    
    const orgId = genId();
    await accountsDb.db.execute({sql:'INSERT OR IGNORE INTO organizations(id,name,slug,created_at) VALUES(?,?,?,?)',args:[orgId,organization,genSlug(organization),Date.now()]});
    const org = (await accountsDb.db.execute({sql:'SELECT id,name FROM organizations WHERE name=?',args:[organization]})).rows[0];
    
    const hash = await bcrypt.hash(password,10);
    const userId = genId();
    await accountsDb.db.execute({sql:'INSERT INTO users(id,org_id,name,username,email,department,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?)',args:[userId,org.id,name,username,email,department,hash,Date.now()]});
    
    const userData = {orgId:org.id,orgName:org.name,userName:name,username,email,department,ipAddress:req.ip,userAgent:req.headers['user-agent'],status:'SUCCESS',emailSent:false,telegramSent:false};
    emailService.sendWelcomeEmail(userData);
    telegram.notifyNewRegistration(userData);
    logRegistration(userData);
    
    res.status(201).json({message:'Registered successfully'});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.post('/login', audit('LOGIN','user'), async (req,res) => {
  try {
    const {username,password,organization} = req.body;
    const org = (await accountsDb.db.execute({sql:'SELECT * FROM organizations WHERE name=? OR slug=?',args:[organization,genSlug(organization)]})).rows[0];
    if(!org) return res.status(401).json({error:'Invalid organization'});
    
    const user = (await accountsDb.db.execute({sql:'SELECT * FROM users WHERE org_id=? AND username=?',args:[org.id,username]})).rows[0];
    if(!user || !(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({error:'Invalid credentials'});
    
    const token = jwt.sign({id:user.id,username:user.username,name:user.name,orgId:user.org_id,orgName:org.name,department:user.department,email:user.email},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN});
    res.json({token,user:{id:user.id,name:user.name,department:user.department,organization:org.name}});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// FORGOT PASSWORD FLOW
const otpLimiter = rateLimit({windowMs:15*60*1000,max:3});
router.post('/forgot-password', otpLimiter, async (req,res) => {
  const {email,organization} = req.body;
  const org = (await accountsDb.db.execute({sql:'SELECT id,name FROM organizations WHERE name=?',args:[organization]})).rows[0];
  if(!org) return res.json({message:'If email exists, OTP sent'});
  
  const user = (await accountsDb.db.execute({sql:'SELECT * FROM users WHERE org_id=? AND email=?',args:[org.id,email]})).rows[0];
  if(!user) return res.json({message:'If email exists, OTP sent'});
  
  const otp = Math.floor(100000+Math.random()*900000).toString();
  await accountsDb.db.execute({sql:'INSERT INTO password_resets(id,org_id,user_id,email,otp,expires_at,ip_address,user_agent,created_at) VALUES(?,?,?,?,?,?,?,?,?)',args:[genId(),org.id,user.id,email,otp,Date.now()+900000,req.ip,req.headers['user-agent'],Date.now()]});
  
  emailService.sendOtpEmail({userName:user.name,orgName:org.name,email,otp,ipAddress:req.ip});
  telegram.notifyPasswordReset({userName:user.name,email,department:user.department,orgName:org.name},'REQUEST');
  
  res.json({message:'OTP sent',...(process.env.NODE_ENV==='development'?{dev_otp:otp}:{})});
});

router.post('/reset-password', async (req,res) => {
  const {email,organization,otp,newPassword} = req.body;
  const org = (await accountsDb.db.execute({sql:'SELECT id FROM organizations WHERE name=?',args:[organization]})).rows[0];
  if(!org) return res.status(400).json({error:'Invalid'});
  
  const record = (await accountsDb.db.execute({sql:'SELECT * FROM password_resets WHERE email=? AND org_id=? AND otp=? AND used=0 ORDER BY created_at DESC LIMIT 1',args:[email,org.id,otp]})).rows[0];
  if(!record || record.expires_at < Date.now()) return res.status(401).json({error:'Invalid or expired OTP'});
  
  const hash = await bcrypt.hash(newPassword,10);
  await accountsDb.db.execute({sql:'UPDATE users SET password_hash=? WHERE id=?',args:[hash,record.user_id]});
  await accountsDb.db.execute({sql:'UPDATE password_resets SET used=1 WHERE id=?',args:[record.id]});
  
  emailService.sendPasswordResetConfirmation({userName:'User',orgName:organization,email});
  res.json({message:'Password reset successfully'});
});

module.exports = router;