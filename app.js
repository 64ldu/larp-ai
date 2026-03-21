/**
 * FacialAnalyzer v4.0 — Maximum accuracy edition
 *
 * Sources used for calibration:
 * ─ looksmax.org "Ideal facial ratios and proportions" (canonical community thread)
 * ─ looksmax.org "FACIAL HARMONY RATIOS guide" (307-point scoring system)
 * ─ looksmax.org "38 Most important facial ratios" (high-effort community thread)
 * ─ looksmax.org "A 2-10 Looks Scale" (HARM/ANGU/DIMO/MISC + spread-penalty formula)
 * ─ looksmax.org "Concise Guide for Evaluating PSL Ratings"
 * ─ PMC10335162 — AI analysis Caucasian celebrities (bigonial/bizygomatic 0.87, H/B ratio 1.59)
 * ─ Alfertshofer et al. Facial Plast Surg 2024 (anthropometric standards)
 * ─ ScienceDirect 2025 nasolabial angle study
 * ─ Dove Press 2023 gonial angle study (125.5° ideal)
 *
 * 68-landmark index reference (face-api.js):
 *  0–16   jaw contour L→chin→R
 *  17–21  left brow    22–26 right brow
 *  27–30  nose bridge  31–35 nose base (31=L alar, 35=R alar, 33=subnasale)
 *  36–41  left eye  (36=outer, 39=inner)
 *  42–47  right eye (42=inner, 45=outer)
 *  48–59  outer lips   60–67 inner lips
 *  48=L mouth corner   54=R mouth corner
 *  51=top lip center   57=bottom lip center
 *  62=inner top lip    66=inner bottom lip
 */

/* ─────────────────────────────── IDEAL VALUES TABLE ────────────────────────
   All values sourced from looksmax.org consensus threads + peer-reviewed papers.
   Used for scoring AND for user-facing "your value vs ideal" comparisons.
──────────────────────────────────────────────────────────────────────────── */
const IDEALS = {
    // looksmax.org canonical thread
    FWHR:              { ideal: 1.9,   range: [1.8, 2.0],   unit: 'ratio',  label: 'FWHR' },
    ESR:               { ideal: 0.46,  range: [0.44, 0.47], unit: 'ratio',  label: 'Eye Separation Ratio' },
    midface:           { ideal: 1.00,  range: [0.95, 1.05], unit: 'ratio',  label: 'Midface Ratio (IPD/MFH)' },
    chinPhiltrum:      { ideal: 2.2,   range: [2.0,  2.5],  unit: 'ratio',  label: 'Chin/Philtrum Ratio' },
    bizygoBigonial:    { ideal: 1.35,  range: [1.25, 1.45], unit: 'ratio',  label: 'Bizygo/Bigonial Width' },
    mouthNose:         { ideal: 1.55,  range: [1.4,  1.62], unit: 'ratio',  label: 'Mouth/Nose Width' },
    lowerUpperLip:     { ideal: 1.62,  range: [1.4,  1.8],  unit: 'ratio',  label: 'Lower/Upper Lip Ratio' },
    canthalTilt:       { ideal: 6.0,   range: [4.0,  8.5],  unit: '°',      label: 'Canthal Tilt' },
    gonialAngle:       { ideal: 124,   range: [115,  130],  unit: '°',      label: 'Gonial Angle' },
    EMEangle:          { ideal: 48.5,  range: [47,   50],   unit: '°',      label: 'EME Angle' },
    eyeAspectRatio:    { ideal: 3.2,   range: [3.0,  3.7],  unit: 'ratio',  label: 'Eye Aspect Ratio (W/H)' },
    // Harmony/thirds
    facialThirdsDev:   { ideal: 0,     range: [0,    0.06], unit: '%',      label: 'Facial Thirds Deviation' },
    facialIndex:       { ideal: 1.35,  range: [1.28, 1.42], unit: 'ratio',  label: 'Facial Index (H/W)' },
    // Looksmax.org HARM guide
    jawFrontalAngle:   { ideal: 88,    range: [82,   94],   unit: '°',      label: 'Jaw Frontal Angle' },
    nasalHWratio:      { ideal: 0.75,  range: [0.62, 0.88], unit: 'ratio',  label: 'Nasal H/W Ratio' },
    nasolabialAngle:   { ideal: 95,    range: [85,   110],  unit: '°',      label: 'Nasolabial Angle' },
    eyebrowTilt:       { ideal: 9,     range: [5,    13],   unit: '°',      label: 'Eyebrow Tilt' },
    eyebrowLowset:     { ideal: 0.085, range: [0,    0.5],  unit: 'ratio',  label: 'Brow Low-Setedness' },
    // PMC10335162
    heightBigonial:    { ideal: 1.59,  range: [1.52, 1.66], unit: 'ratio',  label: 'Face H/Bigonial' },
    // Symmetry
    symmetryRaw:       { ideal: 0.97,  range: [0.95, 1.0],  unit: '%',      label: 'Bilateral Symmetry' },
};

/* ─────────────────────────────── HELPERS ─────────────────────────────────── */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Linear map: value in [inL, inH] → [outL, outH], clamped.
 * Works for both ascending and descending output ranges.
 */
const lmap = (v, inL, inH, outL, outH) => {
    const t = (v - inL) / (inH - inL);
    const lo = Math.min(outL, outH), hi = Math.max(outL, outH);
    return clamp(outL + t * (outH - outL), lo, hi);
};

/**
 * Gaussian (bell-curve) score: peaks at `ideal`, falls off with `sigma`.
 */
const gauss = (v, ideal, sigma, floor, peak) =>
    floor + Math.exp(-0.5 * ((v - ideal) / sigma) ** 2) * (peak - floor);

/**
 * Weighted mean of [[value, weight], ...] pairs.
 * Each value is clamped to [0, 10] before weighting.
 */
const wmean = pairs => {
    let t = 0, w = 0;
    for (const [v, wt] of pairs) { t += clamp(v, 0, 10) * wt; w += wt; }
    return t / w;
};

/**
 * Given a value and an ideal + range, returns:
 * { deviation: %, direction: 'above'|'below'|'ideal', inRange: bool }
 */
const compareToIdeal = (val, idealDef) => {
    const dev = ((val - idealDef.ideal) / idealDef.ideal) * 100;
    const inRange = val >= idealDef.range[0] && val <= idealDef.range[1];
    return {
        deviation: Math.abs(dev).toFixed(1),
        direction: Math.abs(dev) < 1 ? 'ideal' : dev > 0 ? 'above' : 'below',
        inRange,
    };
};

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN CLASS
═══════════════════════════════════════════════════════════════════════════ */
class FacialAnalyzer {
    constructor() {
        this.currentImage  = null;
        this.naturalW      = 0;
        this.naturalH      = 0;
        this.measurements  = {};
        this.scores        = {};
        this.isModelLoaded = false;
        this.useTiny       = false;

        this.els = {
            uploadZone:   document.getElementById('uploadZone'),
            fileInput:    document.getElementById('fileInput'),
            previewBox:   document.getElementById('previewBox'),
            previewImg:   document.getElementById('previewImg'),
            faceCanvas:   document.getElementById('faceCanvas'),
            selectBtn:    document.getElementById('selectBtn'),
            analyzeBtn:   document.getElementById('analyzeBtn'),
            status:       document.getElementById('status'),
            loader:       document.getElementById('loader'),
            loaderText:   document.getElementById('loaderText'),
            scoreNum:     document.getElementById('scoreNum'),
            scoreCircle:  document.getElementById('scoreCircle'),
            featuresBox:  document.getElementById('featuresBox'),
            statsSection: document.getElementById('statsSection'),
            statsGrid:    document.getElementById('statsGrid'),
            welcomeModal: document.getElementById('welcomeModal'),
            startBtn:     document.getElementById('startBtn'),
        };

        this.ctx = this.els.faceCanvas.getContext('2d');
        this.bindEvents();
        this.initModels();
    }

    /* ══════════ EVENTS ══════════════════════════════════════════════════════ */
    bindEvents() {
        this.els.uploadZone.addEventListener('click', () => this.els.fileInput.click());
        this.els.selectBtn .addEventListener('click', () => this.els.fileInput.click());
        this.els.fileInput .addEventListener('change', e => this.handleFile(e.target.files[0]));
        this.els.analyzeBtn.addEventListener('click',  () => this.analyze());
        this.els.startBtn  ?.addEventListener('click', () => this.els.welcomeModal?.classList.add('hidden'));

        ['dragover','dragleave','drop'].forEach(evt => {
            this.els.uploadZone.addEventListener(evt, e => {
                e.preventDefault(); e.stopPropagation();
                if      (evt === 'dragover')  this.els.uploadZone.classList.add('dragover');
                else if (evt === 'dragleave') this.els.uploadZone.classList.remove('dragover');
                else if (e.dataTransfer?.files[0]) this.handleFile(e.dataTransfer.files[0]);
            });
        });
    }

    /* ══════════ MODEL INIT ══════════════════════════════════════════════════ */
    async initModels() {
        this.setStatus('Loading models…');
        try {
            await faceapi.nets.ssdMobilenetv1.loadFromUri('./weights');
            await faceapi.nets.faceLandmark68Net.loadFromUri('./weights');
            this.isModelLoaded = true;
            this.setStatus('Ready — upload a photo');
        } catch {
            try {
                await faceapi.nets.tinyFaceDetector.loadFromUri('./weights');
                await faceapi.nets.faceLandmark68Net.loadFromUri('./weights');
                this.isModelLoaded = true;
                this.useTiny = true;
                this.setStatus('Ready (lite mode) — upload a photo');
            } catch {
                this.setStatus('Failed to load models', true);
            }
        }
    }

    /* ══════════ FILE HANDLING ═══════════════════════════════════════════════ */
    handleFile(file) {
        if (!file || !file.type.startsWith('image/')) {
            this.setStatus('Please upload a JPG or PNG image', true);
            return;
        }
        this.els.fileInput.value = '';
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                this.naturalW = img.naturalWidth;
                this.naturalH = img.naturalHeight;
                this.currentImage = img;
                this.els.previewImg.src = img.src;
                this.els.uploadZone.classList.add('hidden');
                this.els.previewBox.classList.add('active');
                this.els.analyzeBtn.disabled = false;
                this.setStatus(`Loaded ${this.naturalW}×${this.naturalH} — click Analyze`);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    /* ══════════ MAIN ANALYSIS ═══════════════════════════════════════════════ */
    async analyze() {
        if (!this.currentImage || !this.isModelLoaded) return;
        this.els.analyzeBtn.disabled = true;
        this.els.loader.classList.add('active');

        try {
            this.setLoader('Checking image quality…');
            const quality = await this.checkImageQuality();
            if (!quality.ok) { this.fail(`Image quality: ${quality.reason}`); return; }

            this.setLoader('Detecting face…');
            const det = await this._detect();
            if (!det) { this.fail('No face detected — use a clear, front-facing photo'); return; }

            const pose = this.checkFacePose(det.landmarks.positions);
            if (!pose.ok) { this.fail(`Bad pose: ${pose.reason}`); return; }

            if (det.detection.box.width < 80 || det.detection.box.height < 80) {
                this.fail('Face too small in frame — move closer or use higher resolution'); return;
            }

            this.setLoader('Measuring proportions…');
            await this.delay(80);
            const p = det.landmarks.positions;
            this.measurements = this.calculateMeasurements(p, det.detection.score);

            this.setLoader('Scoring features…');
            await this.delay(80);
            this.scores = this.calculateScores(this.measurements);

            this.syncCanvas();
            this.drawOverlay(p);
            this.els.loader.classList.remove('active');
            this.els.analyzeBtn.disabled = false;
            this.displayResults(this.scores, this.measurements);
            this._showDevButton();
            this.setStatus('Analysis complete ✓', false, true);
        } catch (err) {
            console.error(err);
            this.fail('Unexpected error — please retry');
        }
    }

    async _detect() {
        if (this.useTiny) {
            return faceapi
                .detectSingleFace(this.currentImage,
                    new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.3 }))
                .withFaceLandmarks();
        }
        return faceapi
            .detectSingleFace(this.currentImage,
                new faceapi.SsdMobilenetv1Options({ minConfidenceScore: 0.35 }))
            .withFaceLandmarks();
    }

    fail(msg) {
        this.els.loader.classList.remove('active');
        this.els.analyzeBtn.disabled = false;
        this.setStatus(msg, true);
    }
    setLoader(t) { this.els.loaderText.textContent = t; }

    /* ══════════ IMAGE QUALITY ═══════════════════════════════════════════════ */
    async checkImageQuality() {
        return new Promise(resolve => {
            const SIZE = 128;
            const cvs = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
            const ctx = cvs.getContext('2d');
            ctx.drawImage(this.currentImage, 0, 0, SIZE, SIZE);
            const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
            let sum = 0;
            const gray = new Float32Array(SIZE * SIZE);
            for (let i = 0, j = 0; i < data.length; i += 4, j++) {
                gray[j] = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
                sum += gray[j];
            }
            const mean = sum / gray.length;
            let variance = 0;
            for (const g of gray) variance += (g - mean) ** 2;
            variance /= gray.length;
            if (variance < 60)  return resolve({ ok: false, reason: `too blurry (score ${variance.toFixed(0)})` });
            if (mean < 25)      return resolve({ ok: false, reason: 'too dark' });
            if (mean > 235)     return resolve({ ok: false, reason: 'overexposed' });
            resolve({ ok: true, sharpness: variance, brightness: mean });
        });
    }

    /* ══════════ POSE CHECK ══════════════════════════════════════════════════ */
    checkFacePose(p) {
        const eyeMidX   = ((p[36].x+p[39].x)/2 + (p[42].x+p[45].x)/2) / 2;
        const faceWidth = this.dist(p[0], p[16]);
        const latOff    = Math.abs(p[30].x - eyeMidX) / faceWidth;
        if (latOff > 0.11)
            return { ok: false, reason: `face rotated (${(latOff*100).toFixed(0)}% lateral offset)` };

        const roll = Math.abs(Math.atan2(p[45].y-p[36].y, p[45].x-p[36].x) * 180/Math.PI);
        if (roll > 14)
            return { ok: false, reason: `head tilted ${roll.toFixed(0)}° — straighten up` };

        // Pitch: removed unreliable nose-bridge ratio check.
        // Nose bridge length (p27→p30) varies by nose shape, not head angle —
        // using it caused false positives on straight-on photos with long/short noses.
        // A proper 2D pitch proxy: compare eye-midpoint Y to the midpoint of
        // (nasion Y, subnasale Y). If the face is pitched forward/back severely,
        // the eyes will appear abnormally high or low relative to the nose mid.
        const eyeMidY       = ((p[36].y+p[39].y)/2 + (p[42].y+p[45].y)/2) / 2;
        const noseMidY      = (p[27].y + p[33].y) / 2;
        const faceH         = this.dist(p[27], p[8]);
        const pitchOffset   = (eyeMidY - noseMidY) / faceH;  // normal: eyes above nose mid → negative
        // Only flag truly extreme cases (chin tucked all the way down or tilted sky-ward)
        if (pitchOffset > 0.25 || pitchOffset < -0.55)
            return { ok: false, reason: 'extreme vertical head pitch — look straight at camera' };

        return { ok: true };
    }

    syncCanvas() {
        const r = this.els.previewImg.getBoundingClientRect();
        this.els.faceCanvas.width = r.width;
        this.els.faceCanvas.height = r.height;
    }

    /* ══════════ MEASUREMENTS ════════════════════════════════════════════════ */
    calculateMeasurements(p, detConf) {
        const m = {};
        m.detectionConfidence = detConf;

        /* ── Frame ── */
        m.faceWidth  = this.dist(p[0],  p[16]);   // bizygomatic
        m.faceHeight = this.dist(p[27], p[8]);    // nasion–gnathion
        m.facialIndex = m.faceHeight / m.faceWidth; // total facial index

        /* ── Facial thirds ── */
        m.upperThird  = this.dist(p[19], p[27]);   // glabella → nasion
        m.middleThird = this.dist(p[27], p[33]);   // nasion → subnasale
        m.lowerThird  = this.dist(p[33], p[8]);    // subnasale → gnathion
        const meanT   = (m.upperThird + m.middleThird + m.lowerThird) / 3;
        m.facialThirdsDev = (
            Math.abs(m.upperThird  - meanT) +
            Math.abs(m.middleThird - meanT) +
            Math.abs(m.lowerThird  - meanT)
        ) / (3 * meanT);
        m.upperThirdPct  = m.upperThird  / (m.upperThird + m.middleThird + m.lowerThird);
        m.middleThirdPct = m.middleThird / (m.upperThird + m.middleThird + m.lowerThird);
        m.lowerThirdPct  = m.lowerThird  / (m.upperThird + m.middleThird + m.lowerThird);
        m.upperThirdDev  = (m.upperThird  - meanT) / meanT;
        m.middleThirdDev = (m.middleThird - meanT) / meanT;
        m.lowerThirdDev  = (m.lowerThird  - meanT) / meanT;

        /* ── Eyes (canthal tilt — FIXED: canvas Y↓, negate for anatomical sign) ── */
        // Left eye:  p[36]=outer canthus (exocanthion), p[39]=inner (endocanthion)
        // Right eye: p[45]=outer canthus,               p[42]=inner
        m.leftCanthal  = -this.tilt(p[39], p[36]);  // positive = outer higher = hunter eyes
        m.rightCanthal = -this.tilt(p[42], p[45]);
        m.avgCanthal   = (m.leftCanthal + m.rightCanthal) / 2;
        m.canthalAsym  = Math.abs(m.leftCanthal - m.rightCanthal);

        m.leftEyeWidth   = this.dist(p[36], p[39]);
        m.rightEyeWidth  = this.dist(p[42], p[45]);
        m.avgEyeWidth    = (m.leftEyeWidth + m.rightEyeWidth) / 2;
        m.eyeWidthAsym   = Math.abs(m.leftEyeWidth - m.rightEyeWidth) /
                           Math.max(m.leftEyeWidth, m.rightEyeWidth, 1);

        // Eye height — average two measurements per eye for accuracy
        m.leftEyeHeight  = (this.dist(p[37], p[41]) + this.dist(p[38], p[40])) / 2;
        m.rightEyeHeight = (this.dist(p[43], p[47]) + this.dist(p[44], p[46])) / 2;
        m.avgEyeHeight   = (m.leftEyeHeight + m.rightEyeHeight) / 2;

        // Eye Aspect Ratio (palpebral fissure W/H) — looksmax ideal 3.0–3.7
        m.eyeAspectRatio = m.avgEyeWidth / Math.max(m.avgEyeHeight, 1);

        // Pupil centres
        const lPupil = { x: (p[36].x+p[39].x)/2, y: (p[36].y+p[39].y)/2 };
        const rPupil = { x: (p[42].x+p[45].x)/2, y: (p[42].y+p[45].y)/2 };
        m.ipd            = this.dist(lPupil, rPupil);
        m.intercanthal   = this.dist(p[39], p[42]);  // inner canthus to inner canthus

        // ESR — Eye Separation Ratio: IPD / bizygomatic width. Looksmax ideal 0.44–0.47
        m.ESR = m.ipd / m.faceWidth;

        // Neoclassical: each eye width = 1/5 face width
        m.neoclassicalEyeRatio = m.avgEyeWidth / (m.faceWidth / 5);  // ideal 1.0
        // Neoclassical: intercanthal = 1 eye-width
        m.neoclassicalIPDRatio = m.intercanthal / m.avgEyeWidth;     // ideal 1.0

        /* ── FWHR: bizygomatic width / (brow to upper lip height) ── */
        // looksmax.org definition: bizygo / (eyebrow midpoint to upper lip)
        const browMidY     = (p[21].y + p[22].y) / 2;
        const upperLipTopY = p[51].y;
        m.upperFaceHeight  = Math.abs(upperLipTopY - browMidY);
        m.FWHR             = m.faceWidth / Math.max(m.upperFaceHeight, 1);  // ideal 1.8–2.0

        /* ── Midface ratio: IPD / midface height (nasion to upper lip) ── */
        // looksmax.org: IPD / (nasion → subnasale height). Ideal ≈ 1.0
        m.midfaceHeight = this.dist(p[27], p[51]);   // nasion to stomion
        m.midfaceRatio  = m.ipd / Math.max(m.midfaceHeight, 1);  // ideal 0.95–1.05

        /* ── Eyebrows ── */
        // Brow-to-eye: distance from brow peak to inner canthus — normalised by eye width
        m.leftBrowToEye  = this.dist(p[21], p[39]);
        m.rightBrowToEye = this.dist(p[22], p[42]);
        m.avgBrowToEye   = (m.leftBrowToEye + m.rightBrowToEye) / 2;
        // browLowsetness = avgBrowToEye / avgEyeWidth
        // ~0.50–0.80 = very low/hooded, ~0.85–1.05 = average, ~1.1+ = high-set
        m.browLowsetness = m.avgBrowToEye / Math.max(m.avgEyeWidth, 1);

        // Brow thickness: vertical span of the brow landmark arc (p17–p21 left, p22–p26 right)
        // Use the max Y spread of the 5 brow points vs their min Y — bigger = thicker brow
        const lBrowYs  = [p[17],p[18],p[19],p[20],p[21]].map(pt => pt.y);
        const rBrowYs  = [p[22],p[23],p[24],p[25],p[26]].map(pt => pt.y);
        const lBrowThk = Math.max(...lBrowYs) - Math.min(...lBrowYs);
        const rBrowThk = Math.max(...rBrowYs) - Math.min(...rBrowYs);
        // Normalise by eye height so it's zoom-independent
        m.browThickness = ((lBrowThk + rBrowThk) / 2) / Math.max(m.avgEyeHeight, 1);
        // Typical values: thin brow ~0.3–0.5, medium ~0.6–0.9, thick ~1.0–1.5

        // Brow tilt: inner→outer direction, negated for anatomical sign
        // Left brow:  p17=inner, p21=outer
        // Right brow: p26=inner, p22=outer  (face-api right brow is reversed order)
        m.leftBrowTilt  = -this.tilt(p[17], p[21]);
        m.rightBrowTilt = -this.tilt(p[26], p[22]);
        m.avgBrowTilt   = (m.leftBrowTilt + m.rightBrowTilt) / 2;

        /* ── Jaw ── */
        m.jawWidth            = this.dist(p[3],  p[13]);   // bigonial
        m.jawRatio            = m.jawWidth / m.faceWidth;
        m.jawAngle            = this.angle(p[4], p[3], p[8]);  // gonial angle
        m.heightBigonialRatio = m.faceHeight / m.jawWidth;     // PMC10335162: ideal 1.59

        // Bizygo / bigonial ratio — looksmax: bizygo/bigonial should be 1.35 (bizygo is wider)
        m.bizygoBigonialRatio = m.faceWidth / m.jawWidth;   // ideal ~1.35

        // Jaw frontal angle (HARM guide: 82–94°)
        // Angle between jaw base line and a vertical reference
        m.jawFrontalAngle = this.angle(p[3], p[4], { x: p[4].x, y: p[4].y + 100 });

        /* ── Zygomatic ── */
        m.zygomaticWidth      = this.dist(p[1],  p[15]);
        m.zygomaticProminence = m.zygomaticWidth / m.faceWidth;

        /* ── Temples ── */
        m.leftTemple  = this.dist(p[0],  p[1]);
        m.rightTemple = this.dist(p[15], p[16]);
        m.templeWidth = (m.leftTemple + m.rightTemple) / 2;
        m.templeRatio = m.templeWidth / (m.faceWidth * 0.15);
        // Bitemporal width: ideal 89–100% of bizygomatic
        m.bitemporalRatio = (m.leftTemple + m.rightTemple + m.faceWidth * 0.5) / m.faceWidth;

        /* ── Maxilla / midface ──
           Frontal photos cannot measure forward projection (that needs profile).
           Instead we score the FRONTAL MIDFACE HARMONY — two things visible from front:
           1. Midface ratio (IPD/MFH) — already computed; compact midface = good maxilla support
           2. Nasal base width vs intercanthal (alar/IC ratio) — wide alar base = flat/retrusive maxilla
           3. Relative midface length: middle-third as fraction of face height (ideal 0.32–0.38)
        */
        m.maxillaDepth      = this.dist(p[27], p[33]);
        m.maxillaProjection = m.maxillaDepth / m.faceHeight;   // kept for stats display
        // Midface length ratio — how large is the middle third relative to total face
        m.midfaceLengthRatio = m.middleThird / m.faceHeight;   // ideal 0.32–0.38

        /* ── Nose ── */
        m.noseWidth        = this.dist(p[31], p[35]);   // alar base width
        m.noseHeight       = this.dist(p[27], p[33]);   // nasion–subnasale
        m.nasalHWratio     = m.noseWidth / m.noseHeight;  // ideal W/H 0.62–0.88
        m.alarIntercanthal = m.noseWidth / m.intercanthal;  // ideal ≈ 1.0 (Alfertshofer 2024)
        // Mouth to nose width — looksmax ideal 1.4–1.62
        m.mouthWidth       = this.dist(p[48], p[54]);
        m.mouthNoseRatio   = m.mouthWidth / Math.max(m.noseWidth, 1);
        // Nose tip centrality: how well nose tip (p30) aligns with face midline
        // Expressed as fraction of face width — ideal = 0 (perfectly centred)
        const faceMidX       = (p[0].x + p[16].x) / 2;
        m.noseTipDeviation   = Math.abs(p[30].x - faceMidX) / m.faceWidth;  // ideal 0, bad > 0.03
        // Alar symmetry: left vs right alar base distance from midline
        const alarLeftDist   = Math.abs(p[31].x - faceMidX);
        const alarRightDist  = Math.abs(p[35].x - faceMidX);
        m.alarSymmetry       = 1 - Math.abs(alarLeftDist - alarRightDist) / Math.max(alarLeftDist, alarRightDist, 1);
        // Nasolabial angle removed — it's a PROFILE measurement. p30 (nose tip) sits nearly
        // on top of p33 (subnasale) in a frontal photo, making the angle random/unstable.
        m.nasolabialAngle    = null;  // kept as null so stats panel can show N/A

        /* ── Lips ── */
        m.philtrumHeight     = this.dist(p[33], p[51]);   // subnasale → stomion
        m.upperLipHeight     = this.dist(p[51], p[62]);   // stomion → inner upper lip
        m.lowerLipHeight     = this.dist(p[66], p[57]);   // inner lower lip → lower lip
        m.lowerUpperLipRatio = m.lowerLipHeight / Math.max(m.upperLipHeight, 1);  // ideal 1.4–1.8
        m.mouthWidthFace     = m.mouthWidth / m.faceWidth;  // ideal 0.47–0.53

        // Chin to philtrum ratio — looksmax: chin height / philtrum height, ideal 2.0–2.5
        m.chinHeight         = this.dist(p[57], p[8]);    // lower lip → gnathion
        m.chinPhiltrumRatio  = m.chinHeight / Math.max(m.philtrumHeight, 1);   // ideal 2.0–2.5
        m.chinProjection     = m.chinHeight / m.faceHeight;

        // Mentolabial angle
        m.mentolabialAngle   = this.angle(p[57], p[8], { x: p[8].x, y: p[8].y + 60 });

        /* ── EME angle (Eye–Mouth–Eye): vertex at lip centre, arms to pupils ──
           looksmax: ideal 47–50°. Indicator of masculinity + face compactness. */
        const lipCenter = { x: (p[48].x+p[54].x)/2, y: (p[48].y+p[54].y)/2 };
        m.EMEangle = this.angle(lPupil, lipCenter, rPupil);

        /* ── Gonion / mandible ── */
        m.gonionWidth        = this.dist(p[3],  p[13]);
        m.gonionProminence   = m.gonionWidth / m.faceWidth;
        m.mandibleDepth      = this.dist(p[4],  p[12]);
        m.mandibleProminence = m.mandibleDepth / m.faceWidth;

        /* ── Forehead ── */
        m.foreheadWidth = this.dist(p[17], p[26]);
        m.foreheadRatio = m.foreheadWidth / m.faceWidth;

        /* ── Symmetry: 26 bilateral pairs, X+Y axes ── */
        const symPairs = [
            [0,16],[1,15],[2,14],[3,13],[4,12],[5,11],[6,10],[7,9],
            [17,26],[18,25],[19,24],[20,23],[21,22],
            [36,45],[37,44],[38,43],[39,42],[40,47],[41,46],
            [31,35],[32,34],
            [48,54],[49,53],[50,52],[58,56],[60,64],[61,63],
        ];
        const midX = (p[0].x + p[16].x) / 2;
        const midY = (p[27].y + p[8].y)  / 2;
        let symTotal = 0;
        for (const [l, r] of symPairs) {
            const lx = Math.abs(p[l].x - midX), rx = Math.abs(p[r].x - midX);
            const ly = Math.abs(p[l].y - midY), ry = Math.abs(p[r].y - midY);
            const xE = Math.abs(lx - rx) / Math.max(lx, rx, 1);
            const yE = Math.abs(ly - ry) / Math.max(ly, ry, 1);
            symTotal += 1 - clamp(xE*0.6 + yE*0.4, 0, 1);
        }
        m.symmetryRaw = symTotal / symPairs.length;

        return m;
    }

    /* ══════════ SCORES ══════════════════════════════════════════════════════ */
    calculateScores(m) {
        const s   = {};
        const conf = clamp(m.detectionConfidence, 0.5, 1);

        /* SYMMETRY */
        s.symmetry = lmap(m.symmetryRaw, 0.80, 0.985, 2, 10);

        /* GOLDEN RATIO / FACIAL THIRDS */
        s.goldenRatio = lmap(m.facialThirdsDev, 0, 0.25, 10, 2);

        /* FWHR — looksmax: 1.8+ ideal, 2.0 upper, <1.6 bad */
        s.FWHR = gauss(m.FWHR, 1.9, 0.15, 2, 10);

        /* MIDFACE RATIO — IPD/MFH: ideal 1.0. Too long midface = horse face */
        s.midfaceRatio = gauss(m.midfaceRatio, 1.0, 0.08, 2, 10);

        /* EYE AREA — composite + 1.2× buff (eyes are systematically underscored by 2D landmarks)
           ESR sigma loosened slightly — 0.44–0.48 are all genuinely fine spacings. */
        const ctScore       = gauss(m.avgCanthal, 6, 4, 2, 10);
        const ctAsymPenalty = clamp(m.canthalAsym / 3, 0, 2);
        const esrScore      = gauss(m.ESR, 0.46, 0.030, 2, 10);
        const eyeWidthSymScore = lmap(m.eyeWidthAsym, 0, 0.15, 10, 2);
        const earScore      = gauss(m.eyeAspectRatio, 3.25, 0.45, 3, 10);  // wider sigma
        const rawEyeArea    = wmean([
            [clamp(ctScore - ctAsymPenalty, 0, 10), 0.40],
            [esrScore,          0.25],
            [eyeWidthSymScore,  0.15],
            [earScore,          0.20],
        ]);
        s.eyeArea = clamp(rawEyeArea * 1.2, 2, 10);  // 1.2× buff, hard cap at 10

        /* ZYGOMATIC */
        s.zygomatic = lmap(m.zygomaticProminence, 0.76, 0.96, 2, 10);

        /* JAWLINE — gonial angle, bigonial/face ratio, H/B golden ratio, jaw frontal angle */
        const gonialScore     = gauss(m.jawAngle, 124, 7, 2, 10);
        const jawWidthScore   = lmap(m.jawRatio, 0.55, 0.82, 2, 10);
        const hbScore         = gauss(m.heightBigonialRatio, 1.59, 0.12, 2, 10);
        const jawFrontalScore = gauss(m.jawFrontalAngle, 88, 7, 2, 10);
        s.jawline = wmean([
            [gonialScore,     0.30],
            [jawWidthScore,   0.35],
            [hbScore,         0.20],
            [jawFrontalScore, 0.15],
        ]);

        /* BIZYGO/BIGONIAL — looksmax canonical: ideal 1.35 */
        s.bizygoBigonial = gauss(m.bizygoBigonialRatio, 1.35, 0.12, 2, 10);

        /* CHIN / PHILTRUM RATIO — looksmax: 2.0–2.5 */
        s.chinPhiltrum = gauss(m.chinPhiltrumRatio, 2.2, 0.30, 2, 10);

        /* NOSE — frontal-only reliable metrics
           W/H: wide sigma centred 0.65 — narrow (0.45–0.55) AND medium (0.65–0.80) both score well.
           Only extremes (<0.35 or >0.95) are penalised. Nasolabial removed (profile-only). */
        const nasalRatioScore  = gauss(m.nasalHWratio,      0.65,  0.18, 3, 10);
        const alarIcScore      = gauss(m.alarIntercanthal,  1.0,   0.18, 3, 10);
        const mouthNoseScore   = gauss(m.mouthNoseRatio,    1.55,  0.22, 3, 10);
        const noseTipScore     = lmap(m.noseTipDeviation,   0.04,  0,    3, 10);
        const alarSymScore     = lmap(m.alarSymmetry,       0.75,  1.0,  3, 10);
        s.nose = clamp(wmean([
            [nasalRatioScore,  0.30],
            [alarIcScore,      0.25],
            [mouthNoseScore,   0.20],
            [noseTipScore,     0.15],
            [alarSymScore,     0.10],
        ]), 2, 10);

        /* LIPS */
        const lulScore      = gauss(m.lowerUpperLipRatio, 1.62, 0.20, 2, 10);  // looksmax: 1.62 ideal
        const mwFaceScore   = gauss(m.mouthWidthFace, 0.50, 0.05, 2, 10);
        s.lips = wmean([[lulScore, 0.60], [mwFaceScore, 0.40]]);

        /* MIDFACE / MAXILLA (frontal harmony — projection can't be measured from front)
           Three reliable frontal proxies:
           1. Midface ratio (IPD/MFH): compact = good support. Already scored — reuse.
           2. Alar/intercanthal ratio: ideally 1.0. Wide alar = flat/retrusive maxilla.
           3. Midface length ratio: middle-third / face height. Ideal 0.32–0.38.
        */
        const midfaceLenScore  = gauss(m.midfaceLengthRatio, 0.35, 0.05, 3, 10);
        const alarIcMxScore    = gauss(m.alarIntercanthal, 1.0, 0.14, 3, 10);
        const midfaceRatioMxScore = gauss(m.midfaceRatio, 1.0, 0.10, 3, 10);
        s.maxilla = wmean([
            [midfaceLenScore,      0.40],
            [alarIcMxScore,        0.30],
            [midfaceRatioMxScore,  0.30],
        ]);

        /* GONION */
        s.gonion = lmap(m.gonionProminence, 0.60, 0.86, 2, 10);

        /* MANDIBLE */
        s.mandible = lmap(m.mandibleProminence, 0.62, 0.90, 2, 10);

        /* TEMPLES */
        s.temples = clamp(lmap(m.templeRatio, 0.45, 1.50, 2, 10), 2, 10);

        /* EYEBROWS — 3 factors: low-set position (50%), tilt (30%), thickness (20%)
           browLowsetness: ~0.50–0.80 = hooded/ideal, ~0.85–1.05 = average, ~1.1+ = high-set
           browThickness: thick brows (>0.8 normalised) score well; pencil-thin (<0.3) score low
           browTilt: positive = outer higher = masculine arch. Flat (0°) brows still ok for males.
           Floor raised to 4 — eyebrows are rarely a catastrophic trait even when imperfect. */
        const browLowScore   = lmap(m.browLowsetness,  1.15, 0.50, 3, 10);  // lower = better
        const browTiltScore  = gauss(m.avgBrowTilt, 7, 7, 4, 10);           // wide sigma, 0–14° all ok
        const browThickScore = lmap(m.browThickness,   0.25, 1.0,  3, 10);  // thicker = better
        s.eyebrows = clamp(wmean([
            [browLowScore,   0.50],
            [browTiltScore,  0.30],
            [browThickScore, 0.20],
        ]), 2, 10);

        /* EME ANGLE — looksmax: 47–50° ideal */
        s.EMEangle = gauss(m.EMEangle, 48.5, 2.5, 2, 10);

        /* FACIAL INDEX — oval face ideal 1.25–1.45
           Widened sigma (0.22) because this ratio shifts with photo crop tightness.
           Scores anything in 1.1–1.6 reasonably, only penalises extremes. */
        s.facialIndex = gauss(m.facialIndex, 1.35, 0.22, 3, 10);

        /* NEOCLASSICAL CANONS */
        s.neoclassical = wmean([
            [gauss(m.neoclassicalEyeRatio, 1.0, 0.12, 3, 10), 0.50],
            [gauss(m.neoclassicalIPDRatio, 1.0, 0.12, 3, 10), 0.50],
        ]);

        /* ── LOOKSMAX.ORG COMPOSITE SCORING (HARM/ANGU/DIMO/MISC)
           Based on looksmax.org "2-10 Looks Scale" thread formula:
           Score = (HARM×0.32 + MISC×0.26 + ANGU×0.22 + DIMO×0.20)
           Then apply spread penalty: Penalty = spread × 0.1
           (spread = max_subscore - min_subscore)
        ── */

        // HARM (Harmony — 32%) = symmetry, thirds, FWHR, midface, ESR, chin/philtrum
        s.HARM = wmean([
            [s.symmetry,      0.25],
            [s.goldenRatio,   0.15],
            [s.FWHR,          0.15],
            [s.midfaceRatio,  0.15],
            [s.bizygoBigonial,0.15],
            [s.chinPhiltrum,  0.15],
        ]);

        // ANGU (Angularity — 22%) = jawline, zygomatic, gonion, mandible, chin
        s.ANGU = wmean([
            [s.jawline,   0.30],
            [s.zygomatic, 0.25],
            [s.gonion,    0.20],
            [s.mandible,  0.15],
            [s.chinPhiltrum, 0.10],
        ]);

        // DIMO (Dimorphism — 20%) = jawline, FWHR, brow position, eye aspect ratio, gonion
        // Dimorphism = how masculine: wide jaw, low brows, compact eyes, prominent gonion
        s.DIMO = wmean([
            [s.jawline,   0.30],
            [s.FWHR,      0.25],
            [s.eyebrows,  0.20],   // low-set brows = masculine
            [s.gonion,    0.15],
            [s.eyeArea,   0.10],   // hunter eyes = masculine
        ]);

        // MISC (Miscellaneous features — 26%) = nose, lips, eyes, temples, EME
        s.MISC = wmean([
            [s.eyeArea,      0.25],
            [s.nose,         0.20],
            [s.lips,         0.15],
            [s.temples,      0.10],
            [s.EMEangle,     0.15],
            [s.neoclassical, 0.15],
        ]);

        // Weighted composite
        const composite = s.HARM*0.32 + s.MISC*0.26 + s.ANGU*0.22 + s.DIMO*0.20;

        // Spread penalty (looksmax.org formula): weaker version (×0.1)
        const subScores = [s.HARM, s.ANGU, s.DIMO, s.MISC];
        const spread    = Math.max(...subScores) - Math.min(...subScores);
        const penalty   = spread * 0.1;

        // Confidence scalar
        s.overall = clamp((composite - penalty) * (0.88 + 0.12*conf), 0, 10);
        s.looksmaxxRating = this.getLooksmaxxRating(s.overall);

        return s;
    }

    /* ══════════ PSL RATING ══════════════════════════════════════════════════ */
    getLooksmaxxRating(score) {
        // Percentile annotations added from looksmax.org measurement guide
        const R = [
            [9.8, 'TeraChad',  'Perfect genetics — theoretical maximum, essentially non-existent',            '#00ffff', 'Top 0.0001%'],
            [9.5, 'Chad+',     'Genetic elite — world-class model / actor tier',                               '#00d4ff', 'Top 0.001%'],
            [9.0, 'Chad',      'Exceptional — top-tier genetics, rare in daily life',                          '#0af5a0', 'Top 0.01%'],
            [8.5, 'Chadlite',  'Very good looking — strong features, high harmony',                            '#30d158', 'Top 0.1%'],
            [8.0, 'HHTN',      'High High Tier Normie — clearly above average, possible model tier',           '#30d158', 'Top 0.5%'],
            [7.5, 'HTN',       'High Tier Normie — good looking, stands out in a crowd',                       '#34c759', 'Top 2%'],
            [7.0, 'LHTN',      'Low High Tier Normie — above average, gets regular compliments',               '#7ee787', 'Top 5%'],
            [6.5, 'HMTN',      'High Mid Tier Normie — slightly above average',                                '#ff9f0a', 'Top 15%'],
            [6.0, 'MTN',       'Mid Tier Normie — average, no major strengths or flaws',                       '#ff9f0a', 'Top 30%'],
            [5.5, 'LMTN',      'Low Mid Tier Normie — slightly below average',                                 '#ff6b35', 'Top 50%'],
            [5.0, 'HLTN',      'High Low Tier Normie — below average',                                         '#ff6b35', 'Bottom 40%'],
            [4.5, 'LTN',       'Low Tier Normie — notably below average',                                      '#ff453a', 'Bottom 25%'],
            [4.0, 'LLTN',      'Low Low Tier Normie — significant flaws in multiple areas',                    '#ff453a', 'Bottom 15%'],
            [3.5, 'Sub-4',     'Below attractive threshold — major structural deficiencies',                   '#ff2d55', 'Bottom 5%'],
            [0,   'Truecel',   'Severe facial disharmony — requires significant intervention',                  '#8b0000', 'Bottom 2%'],
        ];
        for (const [t, label, tooltip, color, pct] of R)
            if (score >= t) return { label, tooltip, color, pct };
        return R[R.length-1].slice(1).reduce((o, v, i) => ({...o, [['label','tooltip','color','pct'][i]]:v}), {});
    }

    /* ══════════ CANVAS OVERLAY ══════════════════════════════════════════════ */
    drawOverlay(p) {
        const cvs = this.els.faceCanvas;
        const ctx = this.ctx;
        const sx  = cvs.width  / this.naturalW;
        const sy  = cvs.height / this.naturalH;
        const s   = pt => ({ x: pt.x*sx, y: pt.y*sy });

        ctx.clearRect(0, 0, cvs.width, cvs.height);

        // Landmark dots
        ctx.fillStyle = 'rgba(48,209,88,0.75)';
        p.forEach(pt => {
            const {x, y} = s(pt);
            ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI*2); ctx.fill();
        });

        ctx.lineWidth = 1.5; ctx.setLineDash([4,4]);

        // Jaw (yellow)
        ctx.strokeStyle = 'rgba(255,214,10,0.55)';
        ctx.beginPath();
        ctx.moveTo(s(p[0]).x, s(p[0]).y);
        for (let i = 1; i <= 16; i++) ctx.lineTo(s(p[i]).x, s(p[i]).y);
        ctx.stroke();

        // Bizygomatic line (cyan)
        ctx.strokeStyle = 'rgba(0,212,255,0.5)';
        ctx.beginPath();
        ctx.moveTo(s(p[0]).x, s(p[0]).y); ctx.lineTo(s(p[16]).x, s(p[16]).y);
        ctx.stroke();

        // Zygomatic arch (lighter cyan)
        ctx.strokeStyle = 'rgba(0,212,255,0.3)';
        ctx.beginPath();
        ctx.moveTo(s(p[1]).x, s(p[1]).y); ctx.lineTo(s(p[15]).x, s(p[15]).y);
        ctx.stroke();

        // Facial thirds (white)
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        [p[27], p[33]].forEach(pt => {
            const {x, y} = s(pt);
            ctx.beginPath(); ctx.moveTo(x-55, y); ctx.lineTo(x+55, y); ctx.stroke();
        });

        // Canthal tilt lines (red solid)
        ctx.setLineDash([]); ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,80,80,0.85)';
        [[p[39], p[36]], [p[42], p[45]]].forEach(([inner, outer]) => {
            ctx.beginPath();
            ctx.moveTo(s(inner).x, s(inner).y);
            ctx.lineTo(s(outer).x, s(outer).y);
            ctx.stroke();
        });

        // Nose width bar (amber)
        ctx.strokeStyle = 'rgba(255,159,10,0.65)';
        ctx.setLineDash([3,3]); ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(s(p[31]).x, s(p[31]).y); ctx.lineTo(s(p[35]).x, s(p[35]).y);
        ctx.stroke();

        // EME triangle (pupil–pupil–lip center, faint purple)
        const lPupil = { x:(p[36].x+p[39].x)/2, y:(p[36].y+p[39].y)/2 };
        const rPupil = { x:(p[42].x+p[45].x)/2, y:(p[42].y+p[45].y)/2 };
        const lipCtr = { x:(p[48].x+p[54].x)/2, y:(p[48].y+p[54].y)/2 };
        ctx.strokeStyle = 'rgba(180,100,255,0.35)';
        ctx.setLineDash([4,4]); ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s(lPupil).x, s(lPupil).y);
        ctx.lineTo(s(rPupil).x, s(rPupil).y);
        ctx.lineTo(s(lipCtr).x, s(lipCtr).y);
        ctx.closePath(); ctx.stroke();

        // Ideal oval
        const cx = (s(p[0]).x + s(p[16]).x) / 2;
        const cy = (s(p[27]).y + s(p[8]).y)  / 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.setLineDash([6,4]); ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy,
            this.measurements.faceWidth  * 0.55 * sx,
            this.measurements.faceHeight * 0.60 * sy,
            0, 0, Math.PI*2);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    /* ══════════ DISPLAY RESULTS ═════════════════════════════════════════════ */
    displayResults(scores, m) {
        const rating  = scores.looksmaxxRating;
        const overall = scores.overall.toFixed(1);

        // Score ring
        this.els.scoreNum.textContent = overall;
        const C = 389.6;
        this.els.scoreCircle.style.strokeDashoffset = C - (scores.overall / 10) * C;

        /* ─── FEATURE METADATA ───────────────────────────────────────────── */
        const META = {
            symmetry: {
                name:'Facial Symmetry',
                what:'Bilateral match across 26 landmark pairs on both X (left-right) and Y (up-down) axes. Truly symmetric faces are rare — most people score 88–94%. Every 0.5% above 95% is a meaningful advantage.',
                ideal:'≥97% bilateral match',
                source:'Bilateral anthropometric standard',
                yourVal: `${(m.symmetryRaw*100).toFixed(1)}%`,
                idealVal:'97–100%',
            },
            goldenRatio: {
                name:'Facial Thirds',
                what:'How evenly the face divides into upper (glabella→nasion), middle (nasion→subnasale), and lower (subnasale→menton) thirds. 1:1:1 is the mathematical ideal. Looksmax community: lower third can be up to 36% of face height.',
                ideal:'<8% total deviation from equal thirds',
                source:'Alfertshofer 2024 + looksmax.org canonical thread',
                yourVal: `${(m.facialThirdsDev*100).toFixed(1)}% deviation`,
                idealVal:'0–8%',
            },
            FWHR: {
                name:'FWHR (Facial Width-to-Height Ratio)',
                what:'Bizygomatic width divided by the distance from eyebrow midpoint to upper lip. The single most-discussed ratio on looksmax.org. Higher = wider, more masculine. Dominant halo trait. Low FWHR = narrow, feminine, "longface".',
                ideal:'1.8–2.0 (higher is better within range)',
                source:'looksmax.org canonical thread + dominance literature',
                yourVal: m.FWHR.toFixed(3),
                idealVal:'1.80–2.0',
            },
            midfaceRatio: {
                name:'Midface Ratio (IPD/MFH)',
                what:'Interpupillary distance divided by midface height (nasion to upper lip). Ideal is 1:1 — a "compact" midface. Values above 1.1 suggest a long, "horse-face" midface. Below 0.9 suggests an overly short midface.',
                ideal:'0.95–1.05 (1.0 = perfect compact midface)',
                source:'looksmax.org ideal ratios thread + PMC10335162',
                yourVal: m.midfaceRatio.toFixed(3),
                idealVal:'0.95–1.05',
            },
            eyeArea: {
                name:'Eye Area',
                what:'4-factor composite with 1.2× buff (eyes are systematically underscored by 2D frontal landmarks): canthal tilt (40%), eye separation ratio/ESR (25%), eye width symmetry (15%), eye aspect ratio/palpebral W:H (20%). Canthal tilt is the dominant driver — positive degrees = outer corner higher = hunter eyes. Buff is capped at 10.',
                ideal:'Canthal +4–8°, ESR 0.44–0.48, EAR 3.0–3.7',
                source:'looksmax.org guides + PSL community consensus',
                yourVal: `Canthal ${m.avgCanthal.toFixed(1)}° | ESR ${m.ESR.toFixed(3)} | EAR ${m.eyeAspectRatio.toFixed(2)}`,
                idealVal:'CT: +4–8°  ESR: 0.44–0.47',
            },
            zygomatic: {
                name:'Zygomatic Arch',
                what:'Cheekbone region width relative to bizygomatic face width. Prominent, high cheekbones are universally rated as attractive — they indicate good bone structure and low body fat. A key "halo" feature.',
                ideal:'>88% of bizygomatic width',
                source:'PMC10335162 celebrity analysis + community consensus',
                yourVal: `${(m.zygomaticProminence*100).toFixed(1)}%`,
                idealVal:'88–96%',
            },
            jawline: {
                name:'Jawline',
                what:'4-factor composite: gonial angle (30%), bigonial/face-width (35%), face-height/bigonial golden ratio (20%), jaw frontal angle (15%). Looksmax: jaw width should be 85–93% of bizygomatic width, gonial 115–130° optimal.',
                ideal:'Gonial 118–130°, jaw/face 0.75–0.85, jaw frontal 82–94°',
                source:'looksmax.org concise guide + Dove Press 2023 gonial study',
                yourVal: `Gonial ${m.jawAngle.toFixed(0)}° | W/F ${m.jawRatio.toFixed(3)}`,
                idealVal:'Gonial: 118–130°',
            },
            bizygoBigonial: {
                name:'Bizygo/Bigonial Ratio',
                what:'Bizygomatic width divided by bigonial (jaw) width. The looksmax.org canonical thread lists ideal as 1.35 — cheekbones about 35% wider than the jaw. Too low = weak jaw; too high = narrow jaw relative to cheekbones.',
                ideal:'1.25–1.45 (ideal ~1.35)',
                source:'looksmax.org "ideal facial ratios" canonical thread',
                yourVal: m.bizygoBigonialRatio.toFixed(3),
                idealVal:'1.25–1.45',
            },
            chinPhiltrum: {
                name:'Chin/Philtrum Ratio',
                what:'Chin height (lower lip to gnathion) divided by philtrum height (subnasale to stomion). Looksmax: ideal 2.0–2.5. Below 2.0 = weak chin; above 2.5 = Jay Leno tier. This ratio captures lower-third vertical balance.',
                ideal:'2.0–2.5 (ideal ~2.2)',
                source:'looksmax.org canonical ideal ratios thread',
                yourVal: m.chinPhiltrumRatio.toFixed(2),
                idealVal:'2.0–2.5',
            },
            nose: {
                name:'Nose',
                what:'5-factor frontal composite: nasal W/H ratio (30%), alar/intercanthal ratio (25%), mouth/nose width ratio (20%), nose tip centrality (15%), alar symmetry (10%). W/H range is wide — narrow noses (0.45–0.55) are refined and score well. Nasolabial angle excluded — it is a profile-only measurement.',
                ideal:'W/H 0.45–0.85, alar/IC ≈ 1.0, mouth/nose 1.35–1.75, tip centred',
                source:'looksmax.org + Alfertshofer 2024',
                yourVal: `W/H ${m.nasalHWratio.toFixed(3)} | A/IC ${m.alarIntercanthal.toFixed(3)} | Tip dev ${(m.noseTipDeviation*100).toFixed(1)}%`,
                idealVal:'W/H: 0.45–0.85',
            },
            lips: {
                name:'Lips',
                what:'Lower/upper lip ratio (60%) and mouth width as fraction of face (40%). Looksmax: lower lip should be 1.62× upper lip height (golden ratio). Mouth width should be ~48–53% of face width.',
                ideal:'Lower/upper ≈ 1.4–1.8, mouth ≈ 48–53% of face',
                source:'looksmax.org lip ratio thread + Penna et al. 2015',
                yourVal: `L/U ${m.lowerUpperLipRatio.toFixed(2)} | W/F ${m.mouthWidthFace.toFixed(3)}`,
                idealVal:'L/U: 1.4–1.8',
            },
            maxilla: {
                name:'Midface / Maxilla',
                what:'Forward projection cannot be measured from a front photo (requires profile). Instead, three reliable frontal proxies are used: (1) midface length ratio — middle third as % of face height, ideal 32–38%, (2) alar base vs intercanthal width — wider alar than IC suggests flat/retrusive midface, (3) midface compactness (IPD/MFH). Together these indicate midface structural balance.',
                ideal:'Midface 32–38% of face H, alar/IC ≈ 1.0, midface ratio ≈ 1.0',
                source:'Frontal anthropometry proxies (Alfertshofer 2024)',
                yourVal: `MF ${(m.midfaceLengthRatio*100).toFixed(1)}% | A/IC ${m.alarIntercanthal.toFixed(3)}`,
                idealVal:'32–38% midface',
            },
            gonion: {
                name:'Gonion',
                what:'Width at the mandibular angles (p[3]–p[13]) relative to face width. Visible, sharp jaw corners are a key masculine marker. Looksmax notes that gonion position below the mouth line is especially attractive.',
                ideal:'75–85% of face width',
                source:'looksmax.org concise guide + facial anthropometry',
                yourVal: `${(m.gonionProminence*100).toFixed(1)}%`,
                idealVal:'75–85%',
            },
            mandible: {
                name:'Mandible',
                what:'Lower jaw depth relative to face width. The mandible is the structural floor of the face — a deep, forward-grown mandible is the core of a strong jawline, and cannot be faked by face fat or grooming.',
                ideal:'75–88% of face width',
                source:'Orthognathic norms + PSL community',
                yourVal: `${(m.mandibleProminence*100).toFixed(1)}%`,
                idealVal:'75–88%',
            },
            temples: {
                name:'Temples',
                what:'Temporal region fullness relative to face width. Full temples frame the upper face, prevent the "skull-like" appearance, and are associated with youth, health, and masculinity. Temple hollowing is a key aging marker.',
                ideal:'Full temporal projection (bitemporal ~89% of bizygomatic)',
                source:'Aesthetic medicine filler norms + looksmax.org HARM guide',
                yourVal: `ratio ${m.templeRatio.toFixed(3)}`,
                idealVal:'ratio > 1.0',
            },
            eyebrows: {
                name:'Eyebrows',
                what:'3-factor composite: low-setedness (50%), tilt angle (30%), thickness (20%). Thickness is measured as the vertical span of brow landmarks normalised by eye height — thick, dense brows score significantly higher. Low-set brows (B/E ratio < 0.80) = hooded/hunter. Tilt: outer corner higher = masculine arch.',
                ideal:'B/E ratio < 0.85, tilt 0–14°, thickness ratio > 0.7',
                source:'looksmax.org HARM guide + corrected landmark mapping',
                yourVal: `B/E ${m.browLowsetness.toFixed(3)} | Tilt ${m.avgBrowTilt.toFixed(1)}° | Thick ${m.browThickness.toFixed(2)}`,
                idealVal:'B/E < 0.85, thick > 0.7',
            },
            EMEangle: {
                name:'EME Angle (Eye–Mouth–Eye)',
                what:'Angle formed at the lip center with lines to each pupil. looksmax.org: ideal 47–50°. This measures face compactness and is a proxy for masculinity and harmony — wider angle = longer face or wider eye spacing.',
                ideal:'47–50°',
                source:'looksmax.org canonical ideal ratios thread',
                yourVal: `${m.EMEangle.toFixed(1)}°`,
                idealVal:'47–50°',
            },
            facialIndex: {
                name:'Facial Index',
                what:'Total face height divided by bizygomatic width. The classical oval face range is 1.25–1.45. Below 1.2 = round/flat. Above 1.55 = long, narrow face ("horse face"). Closely linked to FWHR — they measure complementary things.',
                ideal:'1.25–1.45 (oval)',
                source:'Farkas 1994 classical anthropometry',
                yourVal: m.facialIndex.toFixed(3),
                idealVal:'1.25–1.45',
            },
            neoclassical: {
                name:'Neoclassical Canons',
                what:'Two Renaissance proportion rules: (1) each eye width = 1/5 face width, (2) intercanthal distance = 1 eye-width. Validated in modern attractiveness studies. Both should return a ratio of 1.0.',
                ideal:'Both ratios 0.9–1.1 (1.0 = perfect)',
                source:'Neoclassical canons + PMC10335162 validation',
                yourVal: `Eye ${m.neoclassicalEyeRatio.toFixed(3)} | IC ${m.neoclassicalIPDRatio.toFixed(3)}`,
                idealVal:'1.0 each',
            },
        };

        /* ─── LOOKSMAXXING FIXES ─────────────────────────────────────────── */
        const FIXES = {
            symmetry:`ROOT CAUSES: skeletal misalignment, uneven sleep posture, asymmetric muscle hypertrophy, nasal deviation.\n\nSOFTMAX:\n• Sleep exclusively on your back (most impactful, free)\n• Chew evenly on both sides — stop favouring one side\n• Mewing 24/7 — consistent tongue posture corrects jaw alignment\n\nHARDMAX:\n• Masseter Botox — reduces hypertrophied (dominant) side\n• Rhinoplasty — corrects deviated nasal axis\n• Orthognathic surgery — skeletal correction for severe asymmetry\n• Genioplasty with chin centering — for chin deviation`,

            goldenRatio:`WHICH THIRD IS OFF?\n• Large lower third → mewing, orthodontics, possible chin reduction\n• Small lower third → chin implant / sliding genioplasty\n• Large upper third → surgical hairline lowering\n• Large middle third → rhinoplasty (visual shortening), LeFort I for severe VME\n• Small middle third → maxillary advancement\n\nNOTE: Check your thirds breakdown panel above for exact deviations.`,

            FWHR:`FWHR TOO LOW = narrow, feminine-looking face.\n\nSOFTMAX:\n• Cut body fat to 8–12% — reveals existing bizygomatic width\n• Mastic gum chewing — masseter hypertrophy increases lower FWHR\n• Contour makeup / haircut to visually widen\n\nHARDMAX:\n• Zygomatic implants — most direct upper FWHR fix\n• Cheek filler (HA/CaHA) — temporary (12–18 months)\n• Brow bone reduction — if forehead is making upper face appear tall\n• Buccal fat removal — exposes underlying bone structure\n\nFWHR TOO HIGH (>2.1) = overly wide/blocky:\n• Haircut to add perceived face height`,

            midfaceRatio:`MIDFACE TOO LONG (ratio < 0.95) = "horse face".\n\nFixes:\n• Rhinoplasty — shorten nasal height component\n• Maxillary impaction (surgical) — shortens vertical midface\n• Hairstyle to camouflage (bangs, etc.)\n\nMIDFACE TOO SHORT (ratio > 1.1):\n• Rhinoplasty — can lengthen nasal appearance\n• Le Fort I for vertical increase (rare)`,

            eyeArea:`CANTHAL TILT NEGATIVE OR LOW.\n\nSOFTMAX:\n• Tape method — temporary upward pull on outer canthus\n• Eye exercises (minimal effect)\n\nHARDMAX:\n• Canthoplasty / Canthopexy — surgically lifts outer canthus (+3–5° achievable)\n• Lower eyelid retraction repair — if lids pulling down\n• Brow bone augmentation — projects orbital rim, creates hooded look\n• Orbital rim implants — frames and supports eye area\n• Deep-set eye appearance: brow bone implants push orbit back visually\n\nEYE SPACING (ESR) OFF:\n• Too wide (>0.48): canthal surgery to reposition; hairstyle\n• Too narrow (<0.43): lateral canthoplasty to widen palpebral fissure`,

            zygomatic:`CHEEKBONES UNDERDEVELOPED.\n\nSOFTMAX:\n• Body fat reduction — reveals existing cheekbone structure\n• Mewing + hard chewing — stimulates zygomatic bone remodelling over years\n• Contouring makeup\n\nHARDMAX:\n• Buccal fat removal — exposes existing cheekbone shadow\n• Zygomatic implants (silicone or porous PE) — permanent, most effective\n• Cheek filler (HA/CaHA) — 12–18 months, good starting point\n• LeFort I + zygomatic advancement — surgical, most dramatic`,

            jawline:`JAWLINE DEFICIENT.\n\nSOFTMAX:\n• Cut to 8–12% body fat — reveals mandible definition\n• Mastic gum 60–90 min/day — masseter hypertrophy\n• Mewing — stimulates posterior mandible / ramus development\n\nHARDMAX:\n• Custom wrap-around jaw implants (PPE/silicone) — best overall improvement\n• Mandible angle implants — isolated angularity fix\n• BSSO — if whole jaw is skeletally retruded\n• Chin + angle combo implants — cost-effective lower face overhaul`,

            bizygoBigonial:`BIZYGO/BIGONIAL RATIO OFF.\n\nRatio too high (jaw too narrow vs cheekbones):\n• Jaw implants — widen bigonial width\n• Mandible widening osteotomy\n• HA filler to jaw angle — temporary test\n\nRatio too low (jaw too wide):\n• Masseter reduction (Botox) — reduces lower face width without surgery\n• Jaw shave / mandibuloplasty (surgical)`,

            chinPhiltrum:`CHIN/PHILTRUM RATIO SUBOPTIMAL.\n\nToo low (<2.0) = weak chin:\n• Sliding genioplasty — gold standard, advances + can change vertical height\n• Chin implant (silicone/Medpor) — simpler, direct projection increase\n• HA filler chin — temporary (6–12 months)\n\nToo high (>2.5) = Jay Leno, overprojected:\n• Chin reduction osteotomy\n• This is rare; usually ratio is too low`,

            nose:`NOSE PROPORTIONS SUBOPTIMAL.\n\nW/H too high (wide base):\n• Alar base reduction (alarplasty) — most direct fix\n• Rhinoplasty full — comprehensive correction\n\nNasolabial angle off (90° ideal male):\n• Tip rotation rhinoplasty — most direct\n• Columella strut graft for under-rotation\n• Lip lift — raises lip, indirectly increases nasolabial angle\n\nMouth/nose ratio off:\n• Rhinoplasty narrows nose to match mouth\n• Corner lip lift widens effective mouth`,

            lips:`LIP RATIO SUBOPTIMAL.\n\nSOFTMAX:\n• Lip liner to define and balance\n• Avoid over-lining upper lip (makes ratio worse)\n\nHARDMAX:\n• HA lip filler — selectively augment deficient lip\n• Lip lift — shortens philtrum, dramatically increases upper lip show\n• Corner lip lift — addresses downturned corners\n• Orthodontics — if lip position is dental in origin`,

            maxilla:`MAXILLA RECESSION. Forward maxilla is the structural centrepiece of the face.\n\nSOFTMAX:\n• Hard mewing 24/7 — full tongue flat on palate with suction hold\n• Nose-breathe exclusively — mouth breathing collapses maxilla\n• Correct swallowing: tongue pushes up, not forward\n• Facemask + palate expander — most effective under 18, possible until ~25\n\nHARDMAX:\n• BiMax (LeFort I + BSSO) — advances entire midface and mandible forward\n• LeFort I alone — if only maxilla is recessed`,

            gonion:`JAW ANGLES UNDERDEVELOPED.\n\nSOFTMAX:\n• Mewing consistently stimulates posterior mandible ramus\n• Mastic gum — masseter growth adds lower jaw visual width\n\nHARDMAX:\n• Gonial angle implants — most direct\n• Mandible widening osteotomy\n• HA filler to jaw angle — 8–14 months (test before committing to surgery)`,

            mandible:`MANDIBLE WEAK.\n\nSOFTMAX:\n• Tongue posture 24/7 prevents further recession\n• Chewing exercises\n\nHARDMAX:\n• BSSO — advances entire mandible\n• Genioplasty — advances chin specifically\n• Custom mandible implants — comprehensive depth + definition`,

            temples:`TEMPLES HOLLOW.\n\nSOFTMAX:\n• Hairstyle adjustment (longer sides) to camouflage\n• Face fat at healthy %, not too lean\n\nHARDMAX:\n• HA or CaHA temple filler — 12–24 months, very effective\n• Sculptra (poly-L-lactic acid) — gradual, longer-lasting\n• Autologous fat grafting — permanent, most natural`,

            eyebrows:`EYEBROWS TOO HIGH OR WRONG ANGLE.\n\nSOFTMAX:\n• Stop over-plucking/waxing — let grow thick and full\n• Minoxidil (Rogaine) on brows — increases density, lowers visual line\n• Microblading for lowering the apparent brow position\n• Fill in bottom edge of brow, not the top\n\nHARDMAX:\n• Brow bone augmentation — projects supraorbital rim, physically pushes brows down\n• Surgical brow lowering (rare)\n• Hairline lowering if forehead is large`,

            EMEangle:`EME ANGLE SUBOPTIMAL.\n\nToo wide (>52°) = long face or wide-set eyes:\n• Facial index fix → chin implant, FWHR improvements\n• Eye spacing fix (ESR) → canthal repositioning\n\nToo narrow (<46°) = short, compact, round face:\n• Chin implant to lengthen lower face\n• Hairstyle to add perceived height`,

            facialIndex:`FACIAL INDEX NOT IDEAL.\n\nToo low (<1.2, round/wide face):\n• Chin implant / genioplasty — adds face height\n• Avoid wide-face-enhancing hairstyles\n\nToo high (>1.55, long/narrow face):\n• FWHR improvements (cheekbones, jaw)\n• Hairstyle to add width (side volume)\n• Avoid chin elongation`,

            neoclassical:`NEOCLASSICAL CANONS VIOLATED.\n\nEye width too small relative to face (ratio < 0.85):\n• Orbital rim implants for size appearance\n• Canthal lengthening surgery\n\nIntercanthal too wide (eyes too far apart, ratio > 1.1):\n• Medial canthal repositioning (surgical, aggressive)\n\nIntercanthal too narrow (ratio < 0.9):\n• Lateral canthoplasty to widen palpebral fissure`,
        };

        const scoreColor = v =>
            v >= 8 ? '#30d158' : v >= 6.5 ? '#ff9f0a' : v >= 5 ? '#ff6b35' : '#ff453a';

        const ORDER = [
            'symmetry','goldenRatio','FWHR','midfaceRatio','eyeArea',
            'zygomatic','jawline','bizygoBigonial','chinPhiltrum',
            'nose','lips','maxilla','gonion','mandible','temples',
            'eyebrows','EMEangle','facialIndex','neoclassical',
        ];

        /* ─── Header ─────────────────────────────────────────────────────── */
        let html = `
        <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-block;padding:12px 28px;
                background:${rating.color}18;border:2px solid ${rating.color};border-radius:14px;">
                <span style="font-size:26px;font-weight:900;color:${rating.color};
                    letter-spacing:.04em;">${rating.label}</span>
            </div>
            <div style="font-size:12px;color:rgba(255,255,255,0.45);margin-top:8px;">${rating.tooltip}</div>
            <div style="font-size:11px;color:${rating.color};font-weight:600;margin-top:3px;">${rating.pct}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.2);margin-top:4px;">
                Confidence: ${(m.detectionConfidence*100).toFixed(0)}%
                &nbsp;·&nbsp; ${this.naturalW}×${this.naturalH}px
            </div>
        </div>`;

        /* ─── PSL sub-scores breakdown ───────────────────────────────────── */
        html += `
        <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:14px;margin-bottom:18px;">
            <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.35);
                text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px;">
                Looksmax.org Composite Breakdown
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                ${[
                    ['HARM','Harmony', scores.HARM, '32% weight — ratios & proportions'],
                    ['MISC','Misc Features', scores.MISC, '26% weight — eyes, nose, lips, EME'],
                    ['ANGU','Angularity', scores.ANGU, '22% weight — jaw, zygo, gonion'],
                    ['DIMO','Dimorphism', scores.DIMO, '20% weight — masculinity markers'],
                ].map(([key, label, val, desc]) => {
                    const v = clamp(val, 0, 10);
                    return `
                    <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:10px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                            <span style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.7);">${key} — ${label}</span>
                            <span style="font-size:14px;font-weight:800;color:${scoreColor(v)}">${v.toFixed(1)}</span>
                        </div>
                        <div style="height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
                            <div style="height:100%;width:${v*10}%;background:${scoreColor(v)};transition:width .8s ease;border-radius:2px;"></div>
                        </div>
                        <div style="font-size:10px;color:rgba(255,255,255,0.25);margin-top:5px;">${desc}</div>
                    </div>`;
                }).join('')}
            </div>
        </div>`;

        /* ─── Facial thirds breakdown ────────────────────────────────────── */
        const tSign = v => (v >= 0 ? '+' : '') + (v*100).toFixed(1) + '%';
        const tCol  = v => Math.abs(v) < 0.04 ? '#30d158' : Math.abs(v) < 0.10 ? '#ff9f0a' : '#ff453a';
        html += `
        <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px 14px;margin-bottom:18px;">
            <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.35);
                text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">Facial Thirds Breakdown</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;">
                ${[
                    ['Upper', m.upperThirdPct, m.upperThirdDev],
                    ['Middle', m.middleThirdPct, m.middleThirdDev],
                    ['Lower', m.lowerThirdPct, m.lowerThirdDev],
                ].map(([n, pct, dev]) => `
                <div>
                    <div style="font-size:10px;color:rgba(255,255,255,0.3);margin-bottom:3px;">${n}</div>
                    <div style="font-size:13px;font-weight:700;color:${tCol(dev)}">${(pct*100).toFixed(1)}%</div>
                    <div style="font-size:10px;color:${tCol(dev)};margin-top:2px;">${tSign(dev)}</div>
                </div>`).join('')}
            </div>
            <div style="font-size:10px;color:rgba(255,255,255,0.18);margin-top:8px;text-align:center;">
                Each should be 33.3% · deviation shown relative to mean third
            </div>
        </div>`;

        /* ─── Feature rows ───────────────────────────────────────────────── */
        html += ORDER.map((k, idx) => {
            const rawV = scores[k] ?? 5;
            const v    = clamp(rawV, 0, 10);
            const meta = META[k] || { name:k, what:'', ideal:'', source:'', yourVal:'—', idealVal:'—' };
            const fix  = FIXES[k];
            const bad  = v < 5.5;
            const delay = idx * 35;
            const barColor = scoreColor(v);

            return `
            <div class="feature-item" style="opacity:0;animation:_fi ${0.35}s ease ${delay}ms forwards;">
                <div class="feature-top">
                    <span class="feature-name">${meta.name}</span>
                    <span class="feature-score" style="color:${barColor}">${v.toFixed(1)}</span>
                </div>
                <div class="feature-bar">
                    <div class="feature-fill" style="width:0%;background:${barColor};
                        animation:_fb_${k} 0.7s ease ${delay+200}ms forwards">
                        <style>@keyframes _fb_${k}{to{width:${v*10}%}}</style>
                    </div>
                </div>
                <!-- Your value vs ideal -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;">
                    <div style="background:rgba(255,255,255,0.04);border-radius:5px;padding:5px 7px;">
                        <div style="font-size:9px;color:rgba(255,255,255,0.25);margin-bottom:2px;">YOUR VALUE</div>
                        <div style="font-size:11px;font-weight:600;color:${barColor}">${meta.yourVal}</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.04);border-radius:5px;padding:5px 7px;">
                        <div style="font-size:9px;color:rgba(255,255,255,0.25);margin-bottom:2px;">IDEAL RANGE</div>
                        <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.5)">${meta.idealVal}</div>
                    </div>
                </div>
                <!-- Explanation -->
                <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:6px;line-height:1.55;">${meta.what}</div>
                <div style="font-size:10px;color:rgba(255,255,255,0.18);margin-top:3px;">
                    Ideal: <span style="color:rgba(255,255,255,0.30)">${meta.ideal}</span>
                    &nbsp;·&nbsp; ${meta.source}
                </div>
                ${bad && fix ? `
                <div style="font-size:11px;color:#ff9f0a;margin-top:8px;padding:9px 11px;
                    background:rgba(255,159,10,0.06);border-left:2px solid #ff9f0a;
                    border-radius:4px;white-space:pre-line;line-height:1.65;">${fix}</div>` : ''}
            </div>`;
        }).join('') + `<style>@keyframes _fi{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}</style>`;

        /* ─── PSL scale legend ───────────────────────────────────────────── */
        html += `
        <div style="margin-top:28px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.07);">
            <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.25);
                text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px;">PSL Scale Reference</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;font-size:11px;">
                ${[
                    ['#00ffff','TeraChad','9.8–10','Top 0.0001%'],
                    ['#00d4ff','Chad+','9.5–9.8','Top 0.001%'],
                    ['#0af5a0','Chad','9.0–9.5','Top 0.01%'],
                    ['#30d158','Chadlite','8.5–9.0','Top 0.1%'],
                    ['#30d158','HHTN','8.0–8.5','Top 0.5%'],
                    ['#34c759','HTN','7.5–8.0','Top 2%'],
                    ['#7ee787','LHTN','7.0–7.5','Top 5%'],
                    ['#ff9f0a','HMTN','6.5–7.0','Top 15%'],
                    ['#ff9f0a','MTN','6.0–6.5','Top 30%'],
                    ['#ff6b35','LMTN','5.5–6.0','Top 50%'],
                    ['#ff6b35','HLTN','5.0–5.5','Bottom 40%'],
                    ['#ff453a','LTN','4.5–5.0','Bottom 25%'],
                    ['#ff453a','LLTN','4.0–4.5','Bottom 15%'],
                    ['#ff2d55','Sub-4','3.5–4.0','Bottom 5%'],
                    ['#8b0000','Truecel','<3.5','Bottom 2%'],
                ].map(([c,l,r,p]) =>
                    `<div style="display:flex;align-items:center;gap:5px;">
                        <span style="color:${c};font-weight:700;min-width:58px;">${l}</span>
                        <span style="color:rgba(255,255,255,0.28)">${r}</span>
                        <span style="color:rgba(255,255,255,0.15);font-size:9px;margin-left:auto">${p}</span>
                    </div>`
                ).join('')}
            </div>
        </div>`;

        this.els.featuresBox.innerHTML = html;

        /* ─── Stats panel (40 measurements) ─────────────────────────────── */
        this.els.statsSection.classList.add('active');
        const rows = [
            // Core frame
            ['Face Width',         `${m.faceWidth.toFixed(0)}px`],
            ['Face Height',        `${m.faceHeight.toFixed(0)}px`],
            ['Facial Index (H/W)', `${m.facialIndex.toFixed(3)}`],
            ['FWHR',               `${m.FWHR.toFixed(3)}`],
            // Canthal
            ['Left Canthal',       `${m.leftCanthal.toFixed(2)}°`],
            ['Right Canthal',      `${m.rightCanthal.toFixed(2)}°`],
            ['Avg Canthal',        `${m.avgCanthal.toFixed(2)}°`],
            ['Canthal Asymmetry',  `${m.canthalAsym.toFixed(2)}°`],
            // Eyes
            ['IPD',                `${m.ipd.toFixed(0)}px`],
            ['ESR (IPD/Bizygo)',   `${m.ESR.toFixed(4)}`],
            ['Intercanthal',       `${m.intercanthal.toFixed(0)}px`],
            ['Eye Aspect Ratio',   `${m.eyeAspectRatio.toFixed(2)}`],
            ['Neo Eye Ratio',      `${m.neoclassicalEyeRatio.toFixed(3)}`],
            ['Neo IPD Ratio',      `${m.neoclassicalIPDRatio.toFixed(3)}`],
            // FWHR / midface
            ['Upper Face H',       `${m.upperFaceHeight.toFixed(0)}px`],
            ['Midface Ratio',      `${m.midfaceRatio.toFixed(3)}`],
            // Jaw
            ['Gonial Angle',       `${m.jawAngle.toFixed(1)}°`],
            ['Jaw/Face Ratio',     `${m.jawRatio.toFixed(3)}`],
            ['Bizygo/Bigonial',    `${m.bizygoBigonialRatio.toFixed(3)}`],
            ['H/Bigonial',         `${m.heightBigonialRatio.toFixed(3)}`],
            ['Jaw Frontal Angle',  `${m.jawFrontalAngle.toFixed(1)}°`],
            // Zygomatic
            ['Zygo Prominence',    `${(m.zygomaticProminence*100).toFixed(1)}%`],
            // Nose
            ['Nasal W/H',          `${m.nasalHWratio.toFixed(3)}`],
            ['Nasolabial Angle',   `N/A (profile only)`],
            ['Alar/Intercanthal',  `${m.alarIntercanthal.toFixed(3)}`],
            ['Mouth/Nose Width',   `${m.mouthNoseRatio.toFixed(3)}`],
            ['Nose Tip Deviation', `${(m.noseTipDeviation*100).toFixed(2)}%`],
            ['Alar Symmetry',      `${(m.alarSymmetry*100).toFixed(1)}%`],
            // Lips / chin
            ['Lower/Upper Lip',    `${m.lowerUpperLipRatio.toFixed(3)}`],
            ['Mouth/Face',         `${m.mouthWidthFace.toFixed(3)}`],
            ['Chin/Philtrum',      `${m.chinPhiltrumRatio.toFixed(3)}`],
            ['Chin Proj%',         `${(m.chinProjection*100).toFixed(2)}%`],
            ['Mentolabial Angle',  `${m.mentolabialAngle.toFixed(1)}°`],
            // Brows / temples
            ['Brow/Eye Ratio',     `${m.browLowsetness.toFixed(3)}`],
            ['Avg Brow Tilt',      `${m.avgBrowTilt.toFixed(1)}°`],
            ['Brow Thickness',     `${m.browThickness.toFixed(3)}`],
            ['Temple Ratio',       `${m.templeRatio.toFixed(3)}`],
            ['Forehead Ratio',     `${m.foreheadRatio.toFixed(3)}`],
            // EME
            ['EME Angle',          `${m.EMEangle.toFixed(1)}°`],
            // Symmetry + thirds
            ['Symmetry Raw',       `${(m.symmetryRaw*100).toFixed(2)}%`],
            ['Thirds Deviation',   `${(m.facialThirdsDev*100).toFixed(2)}%`],
            ['Maxilla Proj%',      `${(m.maxillaProjection*100).toFixed(2)}%`],
            ['Midface Length%',    `${(m.midfaceLengthRatio*100).toFixed(2)}%`],
            // Meta
            ['Detect Confidence',  `${(m.detectionConfidence*100).toFixed(0)}%`],
        ];

        this.els.statsGrid.innerHTML = rows.map(([l, v]) =>
            `<div class="stat-box"><div class="stat-label">${l}</div><div class="stat-value">${v}</div></div>`
        ).join('');
    }

    /* ══════════ DEV RAW DATA ════════════════════════════════════════════════ */
    _showDevButton() {
        // Remove old button if re-analyzing
        const old = document.getElementById('_devBtn');
        if (old) old.remove();

        const btn = document.createElement('button');
        btn.id = '_devBtn';
        btn.textContent = '⚙ Dev Raw Data';
        btn.style.cssText = `
            position:fixed;top:14px;left:14px;z-index:900;
            background:#1a1a1a;border:1px solid rgba(255,255,255,0.15);
            color:rgba(255,255,255,0.6);font-size:11px;font-weight:600;
            padding:7px 13px;border-radius:8px;cursor:pointer;
            font-family:-apple-system,BlinkMacSystemFont,sans-serif;
            letter-spacing:0.03em;
            transition:all 0.15s;
        `;
        btn.onmouseenter = () => { btn.style.color='#fff'; btn.style.borderColor='rgba(255,255,255,0.35)'; };
        btn.onmouseleave = () => { btn.style.color='rgba(255,255,255,0.6)'; btn.style.borderColor='rgba(255,255,255,0.15)'; };
        btn.addEventListener('click', () => this._showDevModal());
        document.body.appendChild(btn);
    }

    _showDevModal() {
        const old = document.getElementById('_devModal');
        if (old) { old.remove(); return; }

        const m = this.measurements;
        const s = this.scores;
        if (!m || !s) return;

        // Build raw text dump
        const lines = [
            '═══════════════════════════════════',
            '  LARP.AI — RAW ANALYSIS DUMP',
            '═══════════════════════════════════',
            '',
            '── SCORES ──────────────────────────',
            `  overall          ${s.overall?.toFixed(4)}`,
            `  HARM             ${s.HARM?.toFixed(4)}`,
            `  ANGU             ${s.ANGU?.toFixed(4)}`,
            `  DIMO             ${s.DIMO?.toFixed(4)}`,
            `  MISC             ${s.MISC?.toFixed(4)}`,
            '',
            `  symmetry         ${s.symmetry?.toFixed(4)}`,
            `  goldenRatio      ${s.goldenRatio?.toFixed(4)}`,
            `  FWHR             ${s.FWHR?.toFixed(4)}`,
            `  midfaceRatio     ${s.midfaceRatio?.toFixed(4)}`,
            `  eyeArea          ${s.eyeArea?.toFixed(4)}`,
            `  zygomatic        ${s.zygomatic?.toFixed(4)}`,
            `  jawline          ${s.jawline?.toFixed(4)}`,
            `  bizygoBigonial   ${s.bizygoBigonial?.toFixed(4)}`,
            `  nose             ${s.nose?.toFixed(4)}`,
            `  lips             ${s.lips?.toFixed(4)}`,
            `  maxilla          ${s.maxilla?.toFixed(4)}`,
            `  gonion           ${s.gonion?.toFixed(4)}`,
            `  mandible         ${s.mandible?.toFixed(4)}`,
            `  temples          ${s.temples?.toFixed(4)}`,
            `  eyebrows         ${s.eyebrows?.toFixed(4)}`,
            `  EMEangle         ${s.EMEangle?.toFixed(4)}`,
            `  facialIndex      ${s.facialIndex?.toFixed(4)}`,
            `  neoclassical     ${s.neoclassical?.toFixed(4)}`,
            `  chinPhiltrum     ${s.chinPhiltrum?.toFixed(4)}`,
            '',
            '── MEASUREMENTS ────────────────────',
            `  detectionConf    ${(m.detectionConfidence*100).toFixed(1)}%`,
            `  faceWidth        ${m.faceWidth?.toFixed(2)}px`,
            `  faceHeight       ${m.faceHeight?.toFixed(2)}px`,
            `  headWidth        ${m.headWidth?.toFixed(2)}px`,
            `  jawContourWidth  ${m.jawContourWidth?.toFixed(2)}px`,
            `  facialIndex      ${m.facialIndex?.toFixed(4)}`,
            '',
            `  FWHR             ${m.FWHR?.toFixed(4)}`,
            `  upperFaceHeight  ${m.upperFaceHeight?.toFixed(2)}px`,
            `  midfaceRatio     ${m.midfaceRatio?.toFixed(4)}`,
            `  midfaceHeight    ${m.midfaceHeight?.toFixed(2)}px`,
            '',
            '  ─ Facial Thirds',
            `  upperThird       ${m.upperThird?.toFixed(2)}px  (${(m.upperThirdPct*100).toFixed(1)}%  dev ${(m.upperThirdDev*100).toFixed(1)}%)`,
            `  middleThird      ${m.middleThird?.toFixed(2)}px  (${(m.middleThirdPct*100).toFixed(1)}%  dev ${(m.middleThirdDev*100).toFixed(1)}%)`,
            `  lowerThird       ${m.lowerThird?.toFixed(2)}px  (${(m.lowerThirdPct*100).toFixed(1)}%  dev ${(m.lowerThirdDev*100).toFixed(1)}%)`,
            `  thirdsDevTotal   ${(m.facialThirdsDev*100).toFixed(2)}%`,
            `  usingHairline    ${m.usingHairline}`,
            '',
            '  ─ Eyes',
            `  avgCanthal       ${m.avgCanthal?.toFixed(3)}°`,
            `  leftCanthal      ${m.leftCanthal?.toFixed(3)}°`,
            `  rightCanthal     ${m.rightCanthal?.toFixed(3)}°`,
            `  canthalAsym      ${m.canthalAsym?.toFixed(3)}°`,
            `  ESR              ${m.ESR?.toFixed(4)}`,
            `  IPD              ${m.ipd?.toFixed(2)}px`,
            `  intercanthal     ${m.intercanthal?.toFixed(2)}px`,
            `  eyeAspectRatio   ${m.eyeAspectRatio?.toFixed(4)}`,
            `  avgEyeWidth      ${m.avgEyeWidth?.toFixed(2)}px`,
            `  avgEyeHeight     ${m.avgEyeHeight?.toFixed(2)}px`,
            `  eyeWidthAsym     ${(m.eyeWidthAsym*100).toFixed(2)}%`,
            `  neo eye ratio    ${m.neoclassicalEyeRatio?.toFixed(4)}`,
            `  neo IPD ratio    ${m.neoclassicalIPDRatio?.toFixed(4)}`,
            '',
            '  ─ Jaw / Gonial',
            `  jawAngle         ${m.jawAngle?.toFixed(2)}°`,
            `  jawWidth         ${m.jawWidth?.toFixed(2)}px`,
            `  jawRatio         ${m.jawRatio?.toFixed(4)}`,
            `  jawFrontalAngle  ${m.jawFrontalAngle?.toFixed(2)}°`,
            `  heightBigonial   ${m.heightBigonialRatio?.toFixed(4)}`,
            `  bizygoBigonial   ${m.bizygoBigonialRatio?.toFixed(4)}`,
            `  gonionProminence ${(m.gonionProminence*100).toFixed(2)}%`,
            `  mandiblePromin   ${(m.mandibleProminence*100).toFixed(2)}%`,
            '',
            '  ─ Nose',
            `  nasalHWratio     ${m.nasalHWratio?.toFixed(4)}`,
            `  alarIntercanthal ${m.alarIntercanthal?.toFixed(4)}`,
            `  mouthNoseRatio   ${m.mouthNoseRatio?.toFixed(4)}`,
            `  noseTipDev       ${(m.noseTipDeviation*100).toFixed(2)}%`,
            `  alarSymmetry     ${(m.alarSymmetry*100).toFixed(2)}%`,
            '',
            '  ─ Lips',
            `  lowerUpperLip    ${m.lowerUpperLipRatio?.toFixed(4)}`,
            `  mouthWidthFace   ${m.mouthWidthFace?.toFixed(4)}`,
            `  philtrumHeight   ${m.philtrumHeight?.toFixed(2)}px`,
            `  upperLipHeight   ${m.upperLipHeight?.toFixed(2)}px`,
            `  lowerLipHeight   ${m.lowerLipHeight?.toFixed(2)}px`,
            '',
            '  ─ Eyebrows',
            `  browLowsetness   ${m.browLowsetness?.toFixed(4)}`,
            `  avgBrowTilt      ${m.avgBrowTilt?.toFixed(3)}°`,
            `  browThickness    ${m.browThickness?.toFixed(4)}`,
            '',
            '  ─ Other',
            `  zygomaticPromin  ${(m.zygomaticProminence*100).toFixed(2)}%`,
            `  templeRatio      ${m.templeRatio?.toFixed(4)}`,
            `  EMEangle         ${m.EMEangle?.toFixed(3)}°`,
            `  symmetryRaw      ${(m.symmetryRaw*100).toFixed(3)}%`,
            `  chinPhiltrum     ${m.chinPhiltrumRatio?.toFixed(4)}`,
            `  chinProjection   ${(m.chinProjection*100).toFixed(2)}%`,
            `  midfaceLenRatio  ${(m.midfaceLengthRatio*100).toFixed(2)}%`,
            `  foreheadRatio    ${m.foreheadRatio?.toFixed(4)}`,
            '',
            '  ─ Rating',
            `  label            ${s.looksmaxxRating?.label}`,
            `  percentile       ${s.looksmaxxRating?.pct}`,
            '',
            '═══════════════════════════════════',
        ];

        const text = lines.join('\n');

        const overlay = document.createElement('div');
        overlay.id = '_devModal';
        overlay.style.cssText = `
            position:fixed;inset:0;z-index:2000;
            background:rgba(0,0,0,0.85);
            display:flex;align-items:center;justify-content:center;
            animation:_dmIn 0.18s ease;
        `;
        overlay.innerHTML = `
            <style>@keyframes _dmIn{from{opacity:0}to{opacity:1}}</style>
            <div style="
                background:#0d0d0d;
                border:1px solid rgba(255,255,255,0.12);
                border-radius:16px;
                width:min(560px, calc(100% - 32px));
                max-height:80vh;
                display:flex;flex-direction:column;
                overflow:hidden;
                box-shadow:0 24px 64px rgba(0,0,0,0.9);
            ">
                <div style="
                    display:flex;justify-content:space-between;align-items:center;
                    padding:16px 20px;
                    border-bottom:1px solid rgba(255,255,255,0.07);
                    flex-shrink:0;
                ">
                    <span style="font-size:13px;font-weight:700;color:rgba(255,255,255,0.8);font-family:-apple-system,sans-serif;letter-spacing:0.04em;">⚙ DEV RAW DATA</span>
                    <div style="display:flex;gap:8px;">
                        <button id="_devCopy" style="
                            background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);
                            color:rgba(255,255,255,0.6);font-size:11px;font-weight:600;
                            padding:5px 12px;border-radius:6px;cursor:pointer;
                            font-family:-apple-system,sans-serif;
                        ">Copy</button>
                        <button id="_devClose" style="
                            background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);
                            color:rgba(255,255,255,0.6);font-size:11px;font-weight:600;
                            padding:5px 12px;border-radius:6px;cursor:pointer;
                            font-family:-apple-system,sans-serif;
                        ">✕ Close</button>
                    </div>
                </div>
                <pre id="_devPre" style="
                    margin:0;padding:18px 20px;
                    overflow-y:auto;
                    font-family:'SF Mono','Fira Code','Consolas',monospace;
                    font-size:11.5px;
                    line-height:1.65;
                    color:rgba(255,255,255,0.75);
                    white-space:pre;
                    background:transparent;
                ">${text}</pre>
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.querySelector('#_devClose').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

        const copyBtn = overlay.querySelector('#_devCopy');
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(text).then(() => {
                copyBtn.textContent = 'Copied ✓';
                copyBtn.style.color = '#30d158';
                setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.style.color = 'rgba(255,255,255,0.6)'; }, 2000);
            });
        });
    }

    /* ══════════ MATH UTILS ══════════════════════════════════════════════════ */
    dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

    angle(a, b, c) {
        const A   = Math.atan2(a.y - b.y, a.x - b.x);
        const C   = Math.atan2(c.y - b.y, c.x - b.x);
        let   deg = Math.abs(A - C) * 180 / Math.PI;
        return deg > 180 ? 360 - deg : deg;
    }

    /** Raw atan2 tilt. MUST be negated at call site for anatomical sign. */
    tilt(inner, outer) {
        return Math.atan2(outer.y - inner.y, outer.x - inner.x) * 180 / Math.PI;
    }

    setStatus(msg, isError = false, isSuccess = false) {
        this.els.status.textContent = msg;
        this.els.status.className = `status${isError?' error':''}${isSuccess?' success':''}`;
    }

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

document.addEventListener('DOMContentLoaded', () => new FacialAnalyzer());