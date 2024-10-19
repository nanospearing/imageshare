// TODO: Implement analytics, env variables passthrough

import express from 'express';
import serveStatic from 'serve-static';
import path from 'path';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import mime from 'mime';
import QRCode from 'qrcode';
import minimist from 'minimist';
import ExifReader from 'exifreader';
import { XMLParser, XMLBuilder, XMLValidator} from 'fast-xml-parser';
import { spawn } from 'node:child_process';

// Initialize command line arguments
const args = minimist(process.argv.slice(2));
// Initialize Express
const app = express();
// Domain used for the web server and image URLs
const webDomain = (process.env.DOMAIN || getLocalIP());
// Domain used for Plausible analytics
const plausibleDomain = process.env.PLAUSIBLE_DOMAIN;
// File size limit for uploads
const uploadLimit = Number(process.env.UPLOAD_LIMIT);
// Time delay for automatically deleting images, 
const deleteDelay = (parseInt(args.delay) || 2);
// Default name for image uploads
const defaultImgTitle = 'ImageShare Upload';
// Paths to primary directories
const publicDir = path.resolve(import.meta.dirname, '../public');
const uploadsDir = path.resolve(import.meta.dirname, '../uploads');
const mainDir = path.resolve(import.meta.dirname, '../');
// List of supported MIME types for uploads
const supportedFileTypes = [
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/png',
  'image/apng',
  'image/webp',
  'image/avif'
];
const supportedFileString = supportedFileTypes.map(type => type.split('/')[1].toUpperCase()).join(', ');
// External directory for storing images
// This is not intended for public servers, automatic deletion is not enabled
const externalDir = args.dir;
// Load 3DS game title library
const xmlFile = fs.readFileSync(path.resolve(import.meta.dirname, '3dsreleases.xml'), 'utf-8');
const xmlParser = new XMLParser();
const json3DS = xmlParser.parse(xmlFile);

// Print settings
console.log(`
Domain: ${webDomain}
Image delete delay: ${deleteDelay} minute(s)
Image upload directory: ${(externalDir || 'Default')}
`);

// Create uploads folder, and delete existing one if present
if (fs.existsSync('uploads')) {
  fs.rmSync('uploads', { recursive: true, force: true });
}
fs.mkdirSync('uploads');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (externalDir) {
      cb(null, externalDir);
    } else {
      cb(null, 'uploads');
    }
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = crypto.randomUUID();
    const extension = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${extension}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: uploadLimit * 1024 * 1024 // X MB
  }
});


// Function to get local IP address
// This is used to send images when a domain is not specified
function getLocalIP() {
  const networkInterfaces = os.networkInterfaces();
  for (const interfaceName in networkInterfaces) {
    const addresses = networkInterfaces[interfaceName];
    if (addresses) {
      for (const address of addresses) {
        if (address.family === 'IPv4' && !address.internal) {
          return address.address;
        }
      }
    }
  }
  return null;
}

// Function to detect software title from image
async function getSoftwareTitle(imgFile) {
  const imgExt = path.extname(imgFile).toLowerCase();
  // Exit early if file is not JPG or PNG format
  if ((imgExt != '.png') || (imgExt != '.jpg') || (imgExt != '.jpeg')) {
    return defaultImgTitle;
  }
  const tags = await ExifReader.load(imgFile);
  if (tags['Model']?.description === 'Nintendo 3DS' && tags['Software']?.description) {
    // Image is from a Nintendo 3DS game
    const gamesData = json3DS['releases']['release'];
    // The image contains a shortened game ID (e.g. Animal Crossing New Leaf is 0863 in image and 0004000000086300 in database)
    // Game IDs with letters can have a mixed casing between the image and database (e.g. a Pokemon X screenshot contains ID 0055d but is ID 0004000000055D00 in database), so we need to run toLowerCase() on both values for a match
    const gameId = tags['Software'].description.toLowerCase();
    const match = gamesData.find(game => game.titleid.toString().toLowerCase().includes(gameId));
    if (match) {
      return match.name;
    }
  }
  // Return default software title if none is detected
  return defaultImgTitle;
}

// Function to render header for HTML pages
function renderHead(userAgent) {
  // Set hardcoded viewport for old Nintendo 3DS, set full-size viewport for New Nintendo 3DS and other browsers
  let viewportEl = ''
  if (userAgent.includes('Nintendo 3DS') && (!(userAgent.includes('New Nintendo 3DS')))) {
    viewportEl = '<meta name="viewport" content="width=320" />';
  } else {
    viewportEl = '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">';
  }
  // Set a 16x16 favicon for the 3DS and Wii, set larger icons in multiple sizes for other browsers
  let iconEl = '';
  if (userAgent.includes('Nintendo')) {
    iconEl = '<link rel="icon" href="favicon.ico" type="image/x-icon">';
  } else {
    iconEl = `<link rel="apple-touch-icon" sizes="192x192" href="img/maskable_icon_x192.png">
    <link rel="icon" type="image/png" sizes="16x16" href="img/favicon_x16.png">
    <link rel="icon" type="image/png" sizes="24x24" href="img/favicon_x24.png">`
  }
  // Return string
  const htmlString = `
  <head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>ImageShare</title>
    <link rel="stylesheet" type="text/css" href="/styles.css">
    <meta name="description" content="ImageShare is a lightweight web app for uploading images, created for the Nintendo 3DS and other legacy web browsers.">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black">
    <meta name="apple-mobile-web-app-title" content="ImageShare">
    <meta name="theme-color" content="#7e57c2" />
    ${viewportEl}
    ${iconEl}
    <!-- Web app manifest and Windows tile -->
    <!-- Documentation for Windows tile: https://learn.microsoft.com/en-us/previous-versions/windows/internet-explorer/ie-developer/platform-apis/dn255024(v=vs.85) -->
    <link rel="manifest" href="manifest.json">
    <meta name="application-name" content="ImageShare">
    <meta name="msapplication-TileColor" content="#7e57c2">
    <meta name="msapplication-square150x150logo" content="img/maskable_icon_x192.png">
    <!-- Open Graph card -->
    <meta property="og:type" content="website" />
    <meta property="og:title" content="ImageShare" />
    <meta property="og:description" content="ImageShare is a lightweight web app for uploading images, created for the Nintendo 3DS and other legacy web browsers." />
    <meta property="og:image:width" content="512" />
    <meta property="og:image:height" content="512" />
    <meta property="og:url" content="https://${webDomain}" />
    <meta property="og:image" content="https://${webDomain}/img/maskable_icon_x512.png" />
    <meta name="og:image:alt" content="ImageShare app icon" />
    <meta name="twitter:card" content="summary" />
  </head>`;
  return htmlString;
}


function renderMain(userAgent = '', uploadUrl = '', secure = false, softwareTitle = defaultImgTitle) {
  // Render initial header elements
  // Margin is defined in <body> attributes for ancient browsers, like Netscape 4.x
  let htmlString = `
  <!DOCTYPE html>
  ${renderHead(userAgent)}
  <body marginheight="0" marginwidth="0">
    <div class="header">ImageShare</div>
    <div class="container">
  `;
  // Show QR code if an image has been uploaded
  if (externalDir && uploadUrl) {
    // No QR code is available for images uploaded to a custom directory
    htmlString += `
    <div class="panel">
        <div class="panel-title">${softwareTitle}</div>
        <div class="body">
          <p>Image now available at <b>${externalDir}</b>.</p>
          <p>The image will not be automatically deleted.</p>
        </div>
      </div>
    `;
  } else if (uploadUrl) {
    // Show QR code
    htmlString += `
    <div class="panel">
        <div class="panel-title">${softwareTitle}</div>
        <div align="center">
            <a class="qr-img-link" href="/${uploadUrl}" target="_blank">
              <img class="qr-img" alt="QR code (click to open page in new window)" src="/${uploadUrl.replace('uploads/', 'qr/')}">
            </a>
        </div>
        <div class="body">
          <p>You have ${deleteDelay} minute(s) to save your image before it is automatically deleted.</p>
        </div>
      </div>
    `;
  }
  // Render rest of page
  htmlString += `
      <div class="panel">
        <div class="panel-title">Upload Image</div>
        <div class="body">
          <form action="/" id="upload-form" enctype="multipart/form-data" method="POST">
            <p><input name="img" id="img-btn" type="file" accept="${supportedFileTypes.toString()}" /></p>
            <p><input name="submit" type="submit" value="Upload" /></p>
            <p>${supportedFileString} (${uploadLimit}MB maximum)</p>
          </form>
          <hr>
          <p>ImageShare is a lightweight web app for uploading images with QR codes, created for the Nintendo 3DS and other legacy web browsers. See <a href="https://github.com/corbindavenport/imageshare" target="_blank">tinyurl.com/imgsharegit</a> for more information.</p>
          <p>If you find ImageShare useful, please consider donating to support development and server costs!</p>
          <p style="text-align: center; font-weight: bold;"><a href="https://www.patreon.com/corbindavenport" target="_blank">patreon.com/corbindavenport</a></p>
          <p style="text-align: center; font-weight: bold;"><a href="https://cash.app/$corbdav" target="_blank">cash.app/$corbdav</a> • <a href="https://paypal.me/corbindav" target="_blank">paypal.me/corbindav</a></p>
          <hr />
          <p>Join Discord server: <a href="https://discord.gg/tqJDRsmQVn" target="_blank">discord.gg/tqJDRsmQVn</a></p>
          <p>Follow on Mastodon: <a href="https://toot.community/@corbin" target="_blank">@corbin@toot.community</a>
        </div>
      </div>
    </div>
  </body>
  </html>`;
  return htmlString;
}

// Set up serve-static middleware to serve files from the 'public' folder
app.use(serveStatic(publicDir));

// Handle POST requests with enctype="multipart/form-data"
app.post('*', upload.single('img'), async function (req, res, err) {
  // Check if file type is supported
  if (!supportedFileTypes.includes(req?.file?.mimetype)) {
    console.error('Invalid upload');
    res.sendStatus(500);
    return;
  }
  // Process image upload
  if (req && req.file && req.file.path) {
    console.log(`Uploaded image: ${req.file.path}, MIME type ${req.file.mimetype}`);
    // Detect software title
    const softwareTitle = await getSoftwareTitle(req.file.path);
    // If custom software title is detected, run exiftool to save it to the image description
    if (softwareTitle != defaultImgTitle) {
      spawn('exiftool', [`-Caption-Abstract=${softwareTitle}`, `-ImageDescription=${softwareTitle}`, req.file.path]);
    }
    // Schedule timeout to delete image
    if (!externalDir) {
      const delay = deleteDelay * 60 * 1000;
      setTimeout(async (path) => {
        if (req.file) {
          fs.unlinkSync(req.file.path);
          console.log(`Deleted image: ${req.file.path}`);
        }
      }, delay);
    }
    // Send async Plausible analytics page view if enabled
    if (plausibleDomain) {
      const data = {
        name: 'Upload',
        props: JSON.stringify({ 'Upload Mode': 'Native'}),
        url: '/',
        domain: plausibleDomain
      }
      fetch('https://plausible.io/api/event', {
        method: 'POST',
        headers: {
          'User-Agent': String(req.get('User-Agent')),
          'X-Forwarded-For': (req.headers['x-forwarded-for'] || req.ip),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
    }
    // Display result page
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderMain(String(req.get('User-Agent')), req.file.path, req.secure, softwareTitle));
  } else {
    console.error('Invalid upload');
    res.sendStatus(500);
  }
});

// Handle requests for main page with a custom-rendered interface
// The / and /index.html paths are required, the /index.php path retains compatibility with bookmarks for the older PHP-based ImageShare
app.get(['/', '/index.html', '/index.php'], (req, res) => {
  // Send async Plausible analytics page view if enabled
  if (plausibleDomain) {
    const data = {
      name: 'pageview',
      url: '/',
      domain: plausibleDomain,
    }
    fetch('https://plausible.io/api/event', {
      method: 'POST',
      headers: {
        'User-Agent': String(req.get('User-Agent')),
        'X-Forwarded-For': (req.headers['x-forwarded-for'] || req.ip),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
  }
  // Send page
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(renderMain(String(req.get('User-Agent'))));
});

// Handle requests for images with direct file access
app.get('/uploads/*', async (req, res) => {
  try {
    // Load the image
    const filePath = path.join(mainDir, req.url);
    let data = await fs.promises.readFile(filePath);
    // Set MIME type on image download
    const mimeType = mime.getType(filePath);
    res.setHeader('Content-Type', mimeType);
    // Force browser to download instead of preview
    res.setHeader('Content-Disposition', 'Attachment;');
    // Send image to client
    res.send(data);
  } catch (e) {
    console.log(e);
    res.sendStatus(500);
  }
});

// Handle requests for QR codes
app.get('/qr/*', async (req, res) => {
  const imgUrl = req.params[0]; // Example: 0fbb2132-296b-455e-bcbc-107ca9f103e9.jpg
  // TODO: check for HTTPS/SSL and use that instead if present
  const qrText = `http://${webDomain}:80/uploads/${imgUrl}`;
  try {
    // Generate the QR code
    const qrCodeDataURL = await QRCode.toDataURL(qrText, {
      type: 'image/png',
      width: 350,
      margin: 2,
      errorCorrectionLevel: 'L'
    });
    // Return the QR code
    res.setHeader('Content-Type', 'image/png');
    res.send(Buffer.from(qrCodeDataURL.split(',')[1], 'base64'));
  } catch (error) {
    res.status(500).send('Error generating QR code');
  }
});

// Start the HTTP server
app.listen(8080, () => {
  console.log(`Server is running on http://${webDomain}:8080`);
});