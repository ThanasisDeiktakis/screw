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
let proxyMode = false;

// Cache original presigned URLs for proxy mode (fileId → { put, get })
const proxyUrls = new Map();

function initS3() {
  let endpoint   = process.env.S3_ENDPOINT;
  const region   = process.env.S3_REGION   || 'ru-3';
  bucket         = process.env.S3_BUCKET   || 'screw-files';
  ttlDays        = parseInt(process.env.S3_FILE_TTL_DAYS || '7', 10);
  maxSize        = parseInt(process.env.S3_MAX_FILE_SIZE || '52428800', 10);
  publicUrl      = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '') || null;
  proxyMode      = process.env.S3_PROXY_MODE === '1';

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

  console.log(`[s3] initialized: ${endpoint}/${bucket}, publicUrl: ${publicUrl || '(not set)'}, proxy: ${proxyMode}`);
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
  let downloadUrl = `${base}/${fileId}`;

  if (proxyMode) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host  = req.headers['x-forwarded-host']  || req.headers.host;
    const origin = `${proto}://${host}`;
    // Save original S3 URLs for proxy
    proxyUrls.set(fileId, { put: uploadUrl, get: downloadUrl });
    setTimeout(() => proxyUrls.delete(fileId), 86400_000); // cleanup after 24h
    uploadUrl   = `${origin}/files/put/${fileId}`;
    downloadUrl = `${origin}/files/get/${fileId}`;
  }



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

// Collect raw body from request
function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Proxy PUT: client → Spot → S3
async function proxyPut(req, res) {
  if (!s3 || !proxyMode) return res.status(404).end();

  const cached = proxyUrls.get(req.params.fileId);
  if (!cached) return res.status(404).json({ error: 'Unknown file ID or link expired' });

  try {
    const body = await collectBody(req);
    const resp = await fetch(cached.put, {
      method: 'PUT',
      body,
    });
    res.status(resp.status);
    resp.headers.forEach((v, k) => {
      if (!['transfer-encoding', 'connection'].includes(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    });
    const buf = Buffer.from(await resp.arrayBuffer());
    res.end(buf);
  } catch (e) {
    console.error('[s3-proxy] PUT error:', e.message);
    res.status(502).json({ error: 'S3 proxy error' });
  }
}

// Proxy GET: client → Spot → S3
async function proxyGet(req, res) {
  if (!s3 || !proxyMode) return res.status(404).end();

  const cached = proxyUrls.get(req.params.fileId);
  const target = cached
    ? cached.get
    : `${(process.env.S3_ENDPOINT.startsWith('http') ? process.env.S3_ENDPOINT : 'https://' + process.env.S3_ENDPOINT)}/${bucket}/${req.params.fileId}`;

  try {
    const resp = await fetch(target);
    res.status(resp.status);
    resp.headers.forEach((v, k) => {
      if (!['transfer-encoding', 'connection'].includes(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    });
    const buf = Buffer.from(await resp.arrayBuffer());
    res.end(buf);
  } catch (e) {
    console.error('[s3-proxy] GET error:', e.message);
    res.status(502).json({ error: 'S3 proxy error' });
  }
}

module.exports = { initS3, requestUpload, isConfigured, getMaxSize: () => maxSize, getTtlDays: () => ttlDays, proxyPut, proxyGet };

