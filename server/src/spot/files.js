'use strict';

const crypto = require('crypto');
const { S3Client, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { PutObjectCommand } = require('@aws-sdk/client-s3');


const MAGIC = Buffer.from('SCREWENC');

let s3 = null;
let bucket = null;
let ttlDays = 7;
let maxSize = 52428800; // 50 MB
let publicUrl = null;

function initS3() {
  let endpoint   = process.env.S3_ENDPOINT;
  const region   = process.env.S3_REGION   || 'ru-3';
  bucket         = process.env.S3_BUCKET   || 'screw-files';
  ttlDays        = parseInt(process.env.S3_FILE_TTL_DAYS || '7', 10);
  maxSize        = parseInt(process.env.S3_MAX_FILE_SIZE || '52428800', 10);
  publicUrl      = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '') || null;

  if (!endpoint || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY) {
    console.log('[s3] not configured — file uploads disabled');
    return;
  }

  if (!endpoint.startsWith('http')) endpoint = 'https://' + endpoint;

  s3 = new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId:     process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },


    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  console.log(`[s3] initialized: ${endpoint}/${bucket}, publicUrl: ${publicUrl || '(not set)'}`);
}

// CheckSCREWENC
// Called
async function verifyAndCleanup(fileId) {
  if (!s3) return;
  try {
    const cmd = new GetObjectCommand({
      Bucket: bucket,
      Key:    fileId,
      Range:  'bytes=0-7',
    });
    const resp = await s3.send(cmd);
    const chunks = [];
    for await (const chunk of resp.Body) chunks.push(chunk);
    const header = Buffer.concat(chunks);

    if (!header.equals(MAGIC)) {
      console.warn(`[s3] file ${fileId} missing SCREWENC marker — deleting`);
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: fileId }));
    }
  } catch (e) {
    console.error(`[s3] verify error ${fileId}:`, e.message);

    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: fileId }));
    } catch {}
  }
}


async function requestUpload(req, res) {
  if (!s3) {
    return res.status(503).json({ error: 'S3 not configured' });
  }


  const declaredSize = parseInt(req.body?.size, 10);
  if (declaredSize && declaredSize > maxSize) {
    return res.status(413).json({ error: `File too large. Max ${maxSize} bytes (${Math.round(maxSize / 1024 / 1024)} MB)` });
  }

  const fileId   = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + ttlDays * 86400;




  const putCmd = new PutObjectCommand({
    Bucket: bucket,
    Key:    fileId,
  });

  let uploadUrl;
  try {
    uploadUrl = await getSignedUrl(s3, putCmd, { expiresIn: 900 });
  } catch (e) {
    console.error('[s3] presigned URL error:', e.message);
    return res.status(500).json({ error: 'Failed to create upload link' });
  }


  const base = publicUrl || `https://${new URL(uploadUrl).hostname}`;
  const downloadUrl = `${base}/${fileId}`;



  setTimeout(() => verifyAndCleanup(fileId), 30_000);

  res.json({
    upload_url:   uploadUrl,
    download_url: downloadUrl,
    file_id:      fileId,
    expires_at:   expiresAt,
    max_size:     maxSize,
  });
}


function isConfigured() {
  return s3 !== null;
}

module.exports = { initS3, requestUpload, isConfigured, getMaxSize: () => maxSize, getTtlDays: () => ttlDays };

