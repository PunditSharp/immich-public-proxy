#!/usr/bin/env node

import express from 'express'
import cookieSession from 'cookie-session'
import immich from './immich'
import crypto from 'crypto'
import render from './render'
import dayjs from 'dayjs'
import { NextFunction, Request, Response } from 'express-serve-static-core'
import { Asset, AssetType, ImageSize, KeyType } from './types'
import { addResponseHeaders, getConfigOption, toString } from './functions'
import { decrypt, encrypt } from './encrypt'
import { respondToInvalidRequest } from './invalidRequestHandler'
import { log } from 'console'

// Extend the Request type with a `password` property
declare module 'express-serve-static-core' {
  interface Request {
    password?: string;
  }
}

require('dotenv').config()

const app = express()
app.use(cookieSession({
  name: 'session',
  httpOnly: true,
  sameSite: 'strict',
  secret: crypto.randomBytes(32).toString('base64url')
}))
// Add the EJS view engine, to render the gallery page
app.set('view engine', 'ejs')
// For parsing the password unlock form
app.use(express.json())
// Serve static assets from the 'public' folder as /share/static
app.use('/share/static', express.static('public', { setHeaders: addResponseHeaders }))
// Serve the same assets on /, to allow for /robots.txt and /favicon.ico
app.use(express.static('public', { setHeaders: addResponseHeaders }))
// Remove the X-Powered-By ExpressJS header
app.disable('x-powered-by')

/**
 * Middleware to decode the encrypted data stored in the session cookie
 */
const decodeCookie = (req: Request, _res: Response, next: NextFunction) => {
  const shareKey = req.params.key
  const session = req.session?.[shareKey]
  if (shareKey && session?.iv && session?.cr) {
    try {
      const payload = JSON.parse(decrypt({
        iv: toString(session.iv),
        cr: toString(session.cr)
      }))
      if (payload?.expires && dayjs(payload.expires) > dayjs()) {
        req.password = payload.password
      }
    } catch (e) { }
  }
  next()
}

/*
 * [ROUTE] Healthcheck
 * The path matches for /share/healthcheck, and also the legacy /healthcheck
 */
app.get(/^(|\/share)\/healthcheck$/, async (_req, res) => {
  if (await immich.accessible()) {
    res.send('ok')
  } else {
    res.status(503).send()
  }
})

/*
 * [ROUTE] This is the main URL that someone would visit if they are opening a shared link
 */
app.get('/:shareType(share|s)/:key/:mode(download)?', decodeCookie, async (req, res) => {
  const keyType = immich.getKeyTypeFromShare(req.params.shareType)

  https://photos.familywright.net/share/vsGo7jAYIklkBeXQjyjhMAuBRPe9kig8kegdDa32kADKQQ5I3fvtxj-Mk2ei-YUKOT4if (keyType === KeyType.slug && !getConfigOption('ipp.allowSlugLinks', true)) {
    // Slug type links are not allowed
    respondToInvalidRequest(res, 404, 'Slug links are disabled in config.json')
  } else {
    await immich.handleShareRequest({
      req,
      key: req.params.key,
      keyType,
      mode: req.params.mode,
      password: req.password
    }, res)
  }
})

/*
 * [ROUTE] Receive an unlock request from the password page
 * Stores a cookie with an encrypted payload which expires in 1 hour.
 * After that time, the visitor will need to provide the password again.
 *
 * The data is encrypted/decrypted on the server as a db-less way of
 * managing user session data. The data is provided to the server by the
 * user's browser in its encrypted state.
 */
app.post('/share/unlock', async (req, res) => {
  if (req.session && req.body.key) {
    req.session[req.body.key] = encrypt(JSON.stringify({
      password: req.body.password,
      expires: dayjs().add(1, 'hour').format()
    }))
  }
  res.send()
})

/*
 * [ROUTE] This is the direct link to a photo or video asset
 */
app.get('/share/:type(photo|video)/:key/:id/:size?', decodeCookie, async (req, res) => {
  // Add the headers configured in config.json (most likely `cache-control`)
  addResponseHeaders(res)
  // Check for valid key and ID
  if (!immich.isKey(req.params.key) || !immich.isId(req.params.id)) {
    respondToInvalidRequest(res, 404, 'Invalid key or ID for ' + req.path)
    return
  }

  // Validate the size parameter
  if (req.params.size && !Object.values(ImageSize).includes(req.params.size as ImageSize)) {
    respondToInvalidRequest(res, 404, 'Invalid size parameter ' + req.path)
    return
  }

  // Validate share link and check password before serving assets
  // This prevents direct URL access from bypassing password protection
  // The password is provided from the encrypted session cookie (if set)
  const share = await immich.getShareByKey(req.params.key, req.password)
  if (!share) {
    respondToInvalidRequest(res, 404, 'Invalid share link')
    return
  }

  // If password is required but not provided, redirect to the share page
  if (share.passwordRequired) {
    res.redirect('/share/' + req.params.key)
    return
  }

  // Verify the requested asset belongs to this share link
  const assetBelongsToShare = share.link?.assets?.some(a => a.id === req.params.id)
  const assetHasLivePhotoVideoId = share.link?.assets?.some(a => a.livePhotoVideoId === req.params.id)
  if (!assetBelongsToShare && !assetHasLivePhotoVideoId) {
    respondToInvalidRequest(res, 404, 'Asset not found in share')
    return
  }

  const request = {
    req,
    key: req.params.key,
    range: req.headers.range || ''
  }
  const asset = {
    id: req.params.id,
    key: req.params.key,
    type: req.params.type === 'video' ? AssetType.video : AssetType.image
  } as Asset
  render.assetBuffer(request, res, asset, req.params.size).then()
})

/*
 * [ROUTE] Home page
 *
 * It was requested here to have *something* on the home page:
 * https://github.com/alangrainger/immich-public-proxy/discussions/19
 *
 * If you don't want to see this, set showHomePage as false in your config.json:
 * https://github.com/alangrainger/immich-public-proxy?tab=readme-ov-file#immich-public-proxy-options
 */
if (getConfigOption('ipp.showHomePage', true)) {
  app.get(/^\/(|share)\/*$/, (_req, res) => {
    addResponseHeaders(res)
    res.render('home')
  })
}

 /* [ROUTE] JSON metadata for a shared album - for native app clients
  *
  * Returns a minimal JSON representation of the share: title, description,
  * and a curated asset list. Only exposes data that is already present in
  * the rendered HTML gallery, plus livePhotoVideoId for Live Photo support.
  *
  * Password-protected shares require the password as a query parameter:
  *   GET /share/:key/json?password=hunter2
  *
  * Slug-based share keys are also supported:
  *   GET /s/:key/json
  */
app.get('/:shareType(share|s)/:key/json', decodeCookie, async (req, res) => {
  addResponseHeaders(res)
 
  const keyType = immich.getKeyTypeFromShare(req.params.shareType)
 
  if (!immich.isKey(req.params.key)) {
    res.status(404).json({ error: 'Invalid key format' })
    return
  }
 
  if (keyType === KeyType.slug && !getConfigOption('ipp.allowSlugLinks', true)) {
    res.status(404).json({ error: 'Slug links are disabled' })
    return
  }
 
  // Re-use the existing cookie-decoded password (req.password),
  // or fall back to a query param for clients that can't use cookies.
  // The query param path is safe because getShareByKey validates it against Immich.
  const password = req.password || toString(req.query.password)
 
  // First check if a password is required but not provided
  const shareResult = await immich.getShareByKey(req.params.key, password, keyType)
 
  if (!shareResult.valid) {
    res.status(404).json({ error: 'Share not found' })
    return
  }
 
  if (shareResult.passwordRequired) {
    res.status(401).json({ error: 'Password required' })
    return
  }
 
  const publicShare = await immich.getPublicShare(req.params.key, password, keyType)
 
  if (!publicShare) {
    res.status(404).json({ error: 'Share not found' })
    return
  }
 
  // Don't cache password-protected responses
  if (password) {
    res.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  }
  //log('Returning JSON metadata: ' + JSON.stringify(publicShare))
  res.json(publicShare)
})
/*
 * Send a 404 for all other routes
 */
app.get('*', (req, res) => {
  respondToInvalidRequest(res, 404, 'Invalid route ' + req.path)
})

// Send the correct process error code for any uncaught exceptions
// so that Docker can gracefully restart the container
process.on('uncaughtException', (err) => {
  console.error('There was an uncaught error', err)
  server.close()
  process.exit(1)
})
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  server.close()
  process.exit(1)
})
process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Gracefully shutting down...')
  server.close()
  process.exit(0)
})

// Start the ExpressJS server
const port = process.env.IPP_PORT || 3000
const server = app.listen(port, () => {
  console.log(dayjs().format() + ' Server started on port ' + port)
})
