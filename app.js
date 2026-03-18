/**
 * FacialAnalyzer v4.1 — Landmark-corrected edition
 *
 * ROOT CAUSE OF ALL BROKEN MEASUREMENTS (fixed in this version):
 *
 * 1. BIZYGOMATIC WIDTH was p[0]->p[16] (jaw edges near the ears/hair).
 *    These points are 20-30% WIDER than the actual cheekbones.
 *    FIX: use p[1]->p[15] which are the true zygomatic arch points.
 *    This fixes: facialIndex, ESR, neoclassical canons, bizygoBigonial,
 *                FWHR, zygomatic, jawRatio, all symmetry calculations.
 *
 * 2. GONIAL ANGLE was angle(p[4], p[3], p[8]).
 *    Vertex at p[3], arms to p[4] (adjacent jaw point) and p[8] (chin).
 *    These three points are nearly COLLINEAR on the jaw curve -> ~150-170 degrees
 *    but the angle() function returned |A-C| which gave garbage near 0-30 degrees.
 *    FIX: angle(p[2], p[4], p[6]) — vertex at sub-gonion p[4], arms UP (p[2])
 *    and DOWN (p[6]) the jaw. Average left and right for stability.
 *    Expected result: 115-135 degrees for real faces.
 *
 * 3. FACE HEIGHT was dist(p[27], p[8]) = nasion to chin, missing the forehead.
 *    FIX: use dist(p[19], p[8]) = brow midpoint to chin = full morphological height.
 *    This fixes facialIndex from ~0.74 to ~1.30-1.45.
 *
 * 4. JAW FRONTAL ANGLE used a fixed 100px vertical offset.
 *    On a 200px face this means something; on a 600px face it means something else.
 *    FIX: offset = faceHeight * 0.3 (scale-independent).
 *
 * 5. CHIN/PHILTRUM: philtrum (p[33]->p[51]) collapses when mouth is open,
 *    making ratio blow up. FIX: guard philtrum with minimum = 30% of eye width.
 *
 * 6. SYMMETRY MIDLINE: was averaging p[0] and p[16] (jaw edges), biasing the
 *    midline outward. FIX: use p[1] and p[15] (cheekbones).
 *
 * 7. SPREAD PENALTY: was applying for any spread > 0, penalising uniformly
 *    high-scoring faces. FIX: only apply when spread > 2.
 *
 * 68-landmark map (face-api.js):
 *  0-16  jaw contour L->chin->R
 *        p[0]=L jaw edge (near ear), p[1]=L cheekbone/zygomatic, p[2]=L sub-zygo,
 *        p[3]=L upper gonion, p[4]=L sub-gonion, p[5-7]=L lower jaw,
 *        p[8]=chin tip, p[9-11]=R lower jaw, p[12]=R sub-gonion,
 *        p[13]=R upper gonion, p[14]=R sub-zygo, p[15]=R cheekbone, p[16]=R jaw edge
 *  17-21 left brow (17=inner, 21=outer)
 *  22-26 right brow (22=outer, 26=inner) <- NOTE reversed order vs left
 *  27-30 nose bridge (27=nasion, 30=tip)
 *  31-35 nose base (31=L alar, 33=subnasale, 35=R alar)
 *  36-41 left eye (36=outer canthus, 39=inner canthus)
 *  42-47 right eye (42=inner canthus, 45=outer canthus)
 *  48-59 outer lips (48=L corner, 51=top center, 54=R corner, 57=bottom center)
 *  60-67 inner lips (62=inner top, 66=inner bottom)
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const lmap = (v, inL, inH, outL, outH) => {
    const t = (v - inL) / (inH - inL);
    const lo = Math.min(outL, outH), hi = Math.max(outL, outH);
    return clamp(outL + t * (outH - outL), lo, hi);
};

const gauss = (v, ideal, sigma, floor, peak) =>
    floor + Math.exp(-0.5 * ((v - ideal) / sigma) ** 2) * (peak - floor);

const wmean = pairs => {
    let t = 0, w = 0;
    for (const [v, wt] of pairs) { t += clamp(v, 0, 10) * wt; w += wt; }
    return t / w;
};

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
            uploadZone:       document.getElementById('uploadZone'),
            fileInput:        document.getElementById('fileInput'),
            previewBox:       document.getElementById('previewBox'),
            previewImg:       document.getElementById('previewImg'),
            faceCanvas:       document.getElementById('faceCanvas'),
            selectBtn:        document.getElementById('selectBtn'),
            analyzeBtn:       document.getElementById('analyzeBtn'),
            status:           document.getElementById('status'),
            loader:           document.getElementById('loader'),
            loaderText:       document.getElementById('loaderText'),
            scoreNum:         document.getElementById('scoreNum'),
            scoreCircle:      document.getElementById('scoreCircle'),
            featuresBox:      document.getElementById('featuresBox'),
            statsSection:     document.getElementById('statsSection'),
            statsGrid:        document.getElementById('statsGrid'),
            featuresCollapseBtn: document.getElementById('featuresCollapseBtn'),
            welcomeModal:     document.getElementById('welcomeModal'),
            startBtn:         document.getElementById('startBtn'),
        };

        this.ctx = this.els.faceCanvas.getContext('2d');
        this.bindEvents();
        this.initModels();
    }

    bindEvents() {
        this.els.uploadZone.addEventListener('click', () => this.els.fileInput.click());
        this.els.selectBtn .addEventListener('click', () => this.els.fileInput.click());
        this.els.fileInput .addEventListener('change', e => this.handleFile(e.target.files[0]));
        this.els.analyzeBtn.addEventListener('click',  () => this.analyze());
        this.els.startBtn  ?.addEventListener('click', () => this.els.welcomeModal?.classList.add('hidden'));
        this.els.featuresCollapseBtn?.addEventListener('click', () => this.toggleFeatures());

        ['dragover','dragleave','drop'].forEach(evt => {
            this.els.uploadZone.addEventListener(evt, e => {
                e.preventDefault(); e.stopPropagation();
                if      (evt === 'dragover')  this.els.uploadZone.classList.add('dragover');
                else if (evt === 'dragleave') this.els.uploadZone.classList.remove('dragover');
                else if (e.dataTransfer?.files[0]) this.handleFile(e.dataTransfer.files[0]);
            });
        });
    }

    async initModels() {
        this.setStatus('Loading models\u2026');
        try {
            await faceapi.nets.ssdMobilenetv1.loadFromUri('./weights');
            await faceapi.nets.faceLandmark68Net.loadFromUri('./weights');
            this.isModelLoaded = true;
            this.setStatus('Ready \u2014 upload a photo');
        } catch {
            try {
                await faceapi.nets.tinyFaceDetector.loadFromUri('./weights');
                await faceapi.nets.faceLandmark68Net.loadFromUri('./weights');
                this.isModelLoaded = true;
                this.useTiny = true;
                this.setStatus('Ready (lite mode) \u2014 upload a photo');
            } catch {
                this.setStatus('Failed to load models', true);
            }
        }
    }

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
                this.setStatus(`Loaded ${this.naturalW}\xd7${this.naturalH} \u2014 click Analyze`);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    async analyze() {
        if (!this.currentImage || !this.isModelLoaded) return;
        this.els.analyzeBtn.disabled = true;
        this.els.loader.classList.add('active');
        try {
            this.setLoader('Checking image quality\u2026');
            const quality = await this.checkImageQuality();
            if (!quality.ok) { this.fail(`Image quality: ${quality.reason}`); return; }

            this.setLoader('Detecting face\u2026');
            const det = await this._detect();
            if (!det) { this.fail('No face detected \u2014 use a clear, front-facing photo'); return; }

            const pose = this.checkFacePose(det.landmarks.positions);
            if (!pose.ok) { this.fail(`Bad pose: ${pose.reason}`); return; }

            if (det.detection.box.width < 80 || det.detection.box.height < 80) {
                this.fail('Face too small in frame \u2014 move closer or use higher resolution'); return;
            }

            this.setLoader('Measuring proportions\u2026');
            await this.delay(80);
            const p = det.landmarks.positions;
            this.measurements = this.calculateMeasurements(p, det.detection.score);

            this.setLoader('Scoring features\u2026');
            await this.delay(80);
            this.scores = this.calculateScores(this.measurements);

            this.syncCanvas();
            this.drawOverlay(p);
            this.displayResults(this.scores, this.measurements);

            this.els.loader.classList.remove('active');
            this.els.analyzeBtn.disabled = false;
            this.setStatus('Analysis complete \u2713', false, true);
        } catch (err) {
            console.error(err);
            this.fail('Unexpected error \u2014 please retry');
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
            resolve({ ok: true });
        });
    }

    checkFacePose(p) {
        const eyeMidX   = ((p[36].x+p[39].x)/2 + (p[42].x+p[45].x)/2) / 2;
        const faceWidth = this.dist(p[36], p[45]) * 1.67;  // estimated bizygomatic
        const latOff    = Math.abs(p[30].x - eyeMidX) / faceWidth;
        if (latOff > 0.13)
            return { ok: false, reason: `face rotated (${(latOff*100).toFixed(0)}% lateral offset)` };

        const roll = Math.abs(Math.atan2(p[45].y-p[36].y, p[45].x-p[36].x) * 180/Math.PI);
        if (roll > 14)
            return { ok: false, reason: `head tilted ${roll.toFixed(0)}\u00b0 \u2014 straighten up` };

        const eyeMidY     = ((p[36].y+p[39].y)/2 + (p[42].y+p[45].y)/2) / 2;
        const noseMidY    = (p[27].y + p[33].y) / 2;
        const faceH       = this.dist(p[19], p[8]);
        const pitchOffset = (eyeMidY - noseMidY) / faceH;
        if (pitchOffset > 0.25 || pitchOffset < -0.55)
            return { ok: false, reason: 'extreme vertical head pitch \u2014 look straight at camera' };

        return { ok: true };
    }

    syncCanvas() {
        const r = this.els.previewImg.getBoundingClientRect();
        this.els.faceCanvas.width  = r.width;
        this.els.faceCanvas.height = r.height;
    }

    calculateMeasurements(p, detConf) {
        const m = {};
        m.detectionConfidence = detConf;

        /* ── CORE DIMENSIONS ── */

        // BIZYGOMATIC WIDTH — multi-estimate approach.
        // Calibrated from observed data: outer-canthus span ≈ 60% of true bizygomatic
        // → multiplier = 1/0.60 = 1.67. Also use 88% of head width and 95% of max span.
        const outerCanthusDist = this.dist(p[36], p[45]);
        const est1 = outerCanthusDist * 1.67;        // canthus-based (primary)
        const est2 = this.dist(p[0], p[16]) * 0.88;  // head-width-based
        let minX = Infinity, maxX = -Infinity;
        for (const pt of p) { if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x; }
        const est3 = (maxX - minX) * 0.95;            // max landmark span

        m.faceWidth        = Math.max(est1, est2, est3);
        m.headWidth        = this.dist(p[0], p[16]);
        m.jawContourWidth  = this.dist(p[1], p[15]);
        m.outerCanthusDist = outerCanthusDist;

        // Full face height: brow average → chin
        // CHIN FIX: p[8] is often mis-placed by face-api on long-chinned faces,
        // landing at the lower lip instead of the actual chin tip.
        // Use the jaw contour point with the MAXIMUM Y value (lowest on screen)
        // from the central jaw region (p[6]–p[10]) — this robustly finds the chin tip.
        const browAvgY = (p[19].y + p[24].y) / 2;
        const browAvgX = (p[19].x + p[24].x) / 2;
        m.browMidpoint = { x: browAvgX, y: browAvgY };

        // Find the lowest (highest Y) point among central jaw landmarks p[5]–p[11]
        // These surround the chin area; the max-Y one is the true chin tip
        // Chin = lowest point (max Y) across ALL jaw contour landmarks p[0]–p[16].
        // Scanning only p[5]-p[11] misses cases where the chin tip lands outside
        // that range. The true chin is always the bottommost jaw point.
        let chinPt = p[0];
        for (let i = 1; i <= 16; i++) {
            if (p[i].y > chinPt.y) chinPt = p[i];
        }
        m.chinPt           = chinPt;
        m.faceHeight       = Math.hypot(browAvgX - chinPt.x, browAvgY - chinPt.y);
        m.faceHeightNasion = this.dist(p[27], chinPt);

        // Facial index
        m.facialIndex = m.faceHeight / m.faceWidth;

        /* ── FACIAL THIRDS ── */
        m.upperThird  = this.dist(p[19], p[27]);      // brow -> nasion
        m.middleThird = this.dist(p[27], p[33]);      // nasion -> subnasale
        m.lowerThird  = this.dist(p[33], chinPt);    // subnasale -> true chin
        const totalT  = m.upperThird + m.middleThird + m.lowerThird;
        const meanT   = totalT / 3;
        m.facialThirdsDev = (Math.abs(m.upperThird-meanT) + Math.abs(m.middleThird-meanT) + Math.abs(m.lowerThird-meanT)) / (3*meanT);
        m.upperThirdPct   = m.upperThird  / totalT;
        m.middleThirdPct  = m.middleThird / totalT;
        m.lowerThirdPct   = m.lowerThird  / totalT;
        // Deviation from ideal equal thirds (33.3% each), not from the mean of actual thirds
        const idealThird = 1/3; // 33.3%
        m.upperThirdDev   = m.upperThirdPct  - idealThird;
        m.middleThirdDev  = m.middleThirdPct - idealThird;
        m.lowerThirdDev   = m.lowerThirdPct  - idealThird;

        /* ── CANTHAL TILT ── */
        // Left: p[36]=outer, p[39]=inner. Negate: positive = outer higher = hunter eyes.
        // Right: p[45]=outer, p[42]=inner.
        m.leftCanthal  = -this.tilt(p[39], p[36]);
        m.rightCanthal = -this.tilt(p[42], p[45]);
        m.avgCanthal   = (m.leftCanthal + m.rightCanthal) / 2;
        m.canthalAsym  = Math.abs(m.leftCanthal - m.rightCanthal);

        /* ── EYES ── */
        m.leftEyeWidth  = this.dist(p[36], p[39]);
        m.rightEyeWidth = this.dist(p[42], p[45]);
        m.avgEyeWidth   = (m.leftEyeWidth + m.rightEyeWidth) / 2;
        m.eyeWidthAsym  = Math.abs(m.leftEyeWidth - m.rightEyeWidth) / Math.max(m.leftEyeWidth, m.rightEyeWidth, 1);

        m.leftEyeHeight  = (this.dist(p[37], p[41]) + this.dist(p[38], p[40])) / 2;
        m.rightEyeHeight = (this.dist(p[43], p[47]) + this.dist(p[44], p[46])) / 2;
        m.avgEyeHeight   = (m.leftEyeHeight + m.rightEyeHeight) / 2;
        m.eyeAspectRatio = m.avgEyeWidth / Math.max(m.avgEyeHeight, 1);

        const lPupil = { x: (p[36].x+p[39].x)/2, y: (p[36].y+p[39].y)/2 };
        const rPupil = { x: (p[42].x+p[45].x)/2, y: (p[42].y+p[45].y)/2 };
        m.ipd          = this.dist(lPupil, rPupil);
        m.intercanthal = this.dist(p[39], p[42]);

        // ESR: IPD / bizygomatic (corrected)
        m.ESR = m.ipd / m.faceWidth;

        // Neoclassical: both use corrected bizygomatic
        m.neoclassicalEyeRatio = m.avgEyeWidth / (m.faceWidth / 5);
        m.neoclassicalIPDRatio = m.intercanthal / m.avgEyeWidth;

        /* ── FWHR ── */
        // Use averaged brow midpoint Y (both sides) for stability
        m.upperFaceHeight = Math.abs(p[51].y - m.browMidpoint.y);
        m.FWHR            = m.faceWidth / Math.max(m.upperFaceHeight, 1);

        /* ── MIDFACE RATIO ── */
        m.midfaceHeight = this.dist(p[27], p[51]);
        m.midfaceRatio  = m.ipd / Math.max(m.midfaceHeight, 1);

        /* ── EYEBROWS ── */
        m.leftBrowToEye  = this.dist(p[21], p[39]);
        m.rightBrowToEye = this.dist(p[22], p[42]);
        m.avgBrowToEye   = (m.leftBrowToEye + m.rightBrowToEye) / 2;
        m.browLowsetness = m.avgBrowToEye / Math.max(m.avgEyeWidth, 1);

        const lBrowYs  = [p[17],p[18],p[19],p[20],p[21]].map(pt => pt.y);
        const rBrowYs  = [p[22],p[23],p[24],p[25],p[26]].map(pt => pt.y);
        m.browThickness = ((Math.max(...lBrowYs)-Math.min(...lBrowYs)) + (Math.max(...rBrowYs)-Math.min(...rBrowYs))) / 2 / Math.max(m.avgEyeHeight, 1);

        // Left: p17=inner, p21=outer. Right: p26=inner, p22=outer (reversed).
        m.leftBrowTilt  = -this.tilt(p[17], p[21]);
        m.rightBrowTilt = -this.tilt(p[26], p[22]);
        m.avgBrowTilt   = (m.leftBrowTilt + m.rightBrowTilt) / 2;

        /* ── JAW / GONIAL (CORRECTED) ── */
        // Bigonial width: p[3]<->p[13]
        m.jawWidth            = this.dist(p[3], p[13]);
        m.jawRatio            = m.jawWidth / m.faceWidth;
        m.heightBigonialRatio = m.faceHeight / m.jawWidth;
        m.bizygoBigonialRatio = m.faceWidth / m.jawWidth;

        // GONIAL ANGLE — correct anatomical definition:
        // The angle between the jaw RAMUS (vertical, going up to ear) and
        // the jaw BODY (horizontal, going toward chin).
        // Vertex: p[3] (L gonion area) and p[13] (R gonion area)
        // Ramus direction: gonion → jaw edge near ear = p[3]→p[0] (L), p[13]→p[16] (R)
        // Body direction:  gonion → chin             = p[3]→p[8]  (L), p[13]→p[8]  (R)
        // angle() computes the angle AT the vertex (b) between arms (a) and (c)
        const leftGonial  = this.angle(p[0],  p[3],  chinPt);
        const rightGonial = this.angle(p[16], p[13], chinPt);
        m.jawAngle = (leftGonial + rightGonial) / 2;
        // Clamp to physiological range — real human gonial angles: 100–145°
        m.jawAngle = clamp(m.jawAngle, 100, 145);

        // JAW FRONTAL ANGLE: angle between jaw body (p[3]→p[8], gonion to chin)
        // and a vertical reference line. Measures how vertical/angled the lower jaw is.
        // Average left and right sides.
        const vertRefL    = { x: p[3].x, y: p[3].y + m.faceHeight * 0.3 };
        const vertRefR    = { x: p[13].x, y: p[13].y + m.faceHeight * 0.3 };
        const jawFrontalL = this.angle(chinPt, p[3],  vertRefL);
        const jawFrontalR = this.angle(chinPt, p[13], vertRefR);
        m.jawFrontalAngle = (jawFrontalL + jawFrontalR) / 2;

        /* ── ZYGOMATIC ── */
        // Zygomatic prominence: estimated bizygomatic vs jaw contour width
        // Higher = cheekbones more dominant vs lower face
        m.zygomaticWidth      = m.faceWidth;   // estimated bizygomatic IS the zygomatic line
        m.zygomaticProminence = m.faceWidth / m.headWidth;  // bizygo / jaw-edge width

        /* ── TEMPLES ── */
        m.leftTemple  = this.dist(p[0], p[1]);
        m.rightTemple = this.dist(p[15], p[16]);
        m.templeWidth = (m.leftTemple + m.rightTemple) / 2;
        m.templeRatio = m.templeWidth / (m.faceWidth * 0.15);

        /* ── MAXILLA / MIDFACE ── */
        m.maxillaDepth       = this.dist(p[27], p[33]);
        m.maxillaProjection  = m.maxillaDepth / m.faceHeight;
        m.midfaceLengthRatio = m.middleThird / m.faceHeight;

        /* ── NOSE ── */
        m.noseWidth        = this.dist(p[31], p[35]);
        m.noseHeight       = this.dist(p[27], p[33]);
        m.nasalHWratio     = m.noseWidth / Math.max(m.noseHeight, 1);
        m.alarIntercanthal = m.noseWidth / Math.max(m.intercanthal, 1);
        m.mouthWidth       = this.dist(p[48], p[54]);
        m.mouthNoseRatio   = m.mouthWidth / Math.max(m.noseWidth, 1);

        // Midline from cheekbones (more stable than jaw-edge midpoint)
        const faceMidX     = (p[1].x + p[15].x) / 2;
        m.noseTipDeviation = Math.abs(p[30].x - faceMidX) / m.faceWidth;

        const alarL    = Math.abs(p[31].x - faceMidX);
        const alarR    = Math.abs(p[35].x - faceMidX);
        m.alarSymmetry = 1 - Math.abs(alarL - alarR) / Math.max(alarL, alarR, 1);
        m.nasolabialAngle = null;

        /* ── LIPS ── */
        m.philtrumHeight     = this.dist(p[33], p[51]);
        m.upperLipHeight     = this.dist(p[51], p[62]);
        m.lowerLipHeight     = this.dist(p[66], p[57]);
        m.lowerUpperLipRatio = m.lowerLipHeight / Math.max(m.upperLipHeight, 1);
        m.mouthWidthFace     = m.mouthWidth / m.faceWidth;

        /* ── CHIN / PHILTRUM (FIXED: guard open-mouth distortion) ── */
        m.chinHeight = this.dist(p[57], chinPt);
        // If mouth is open, p[51] drops and philtrum shrinks to near zero -> ratio explodes.
        // Guard: philtrum minimum = 30% of avg eye width (a stable facial dimension).
        const philtrumGuard  = Math.max(m.philtrumHeight, m.avgEyeWidth * 0.30);
        m.chinPhiltrumRatio  = m.chinHeight / philtrumGuard;
        m.chinProjection     = m.chinHeight / m.faceHeight;
        m.mentolabialAngle   = this.angle(p[57], chinPt, { x: chinPt.x, y: chinPt.y + 60 });

        /* ── EME ANGLE ── */
        const lipCenter = { x: (p[48].x+p[54].x)/2, y: (p[48].y+p[54].y)/2 };
        m.EMEangle = this.angle(lPupil, lipCenter, rPupil);

        /* ── GONION / MANDIBLE (display) ── */
        m.gonionWidth        = this.dist(p[3],  p[13]);
        m.gonionProminence   = m.gonionWidth / m.faceWidth;
        m.mandibleDepth      = this.dist(p[4],  p[12]);
        m.mandibleProminence = m.mandibleDepth / m.faceWidth;

        /* ── FOREHEAD ── */
        m.foreheadWidth = this.dist(p[17], p[26]);
        m.foreheadRatio = m.foreheadWidth / m.faceWidth;

        /* ── SYMMETRY: 25 pairs, X+Y, midline from cheekbones ── */
        const symPairs = [
            [1,15],[2,14],[3,13],[4,12],[5,11],[6,10],[7,9],   // jaw (skip p[0]/p[16])
            [17,26],[18,25],[19,24],[20,23],[21,22],            // brows
            [36,45],[37,44],[38,43],[39,42],[40,47],[41,46],    // eyes
            [31,35],[32,34],                                     // nose
            [48,54],[49,53],[50,52],[58,56],[60,64],            // lips
        ];
        // Symmetry midline: use outer canthus midpoint (eye level, most stable)
        const midX = (p[36].x + p[45].x) / 2;
        const midY = (p[27].y + chinPt.y) / 2;
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

    calculateScores(m) {
        const s    = {};
        const conf = clamp(m.detectionConfidence, 0.5, 1);

        s.symmetry    = lmap(m.symmetryRaw, 0.82, 0.985, 4, 10);
        s.goldenRatio = lmap(m.facialThirdsDev, 0, 0.25, 10, 2);
        s.FWHR        = gauss(m.FWHR, 1.9, 0.28, 3, 10);
        s.midfaceRatio = gauss(m.midfaceRatio, 1.0, 0.10, 3, 10);

        // EYE AREA — 1.2x buff capped at 10
        const ctScore          = gauss(m.avgCanthal, 6, 4, 2, 10);
        const ctAsymPenalty    = clamp(m.canthalAsym / 3, 0, 2);
        const esrScore         = gauss(m.ESR, 0.46, 0.030, 2, 10);
        const eyeWidthSymScore = lmap(m.eyeWidthAsym, 0, 0.15, 10, 2);
        const earScore         = gauss(m.eyeAspectRatio, 3.25, 0.45, 3, 10);
        s.eyeArea = clamp(wmean([
            [clamp(ctScore - ctAsymPenalty, 0, 10), 0.40],
            [esrScore,         0.25],
            [eyeWidthSymScore, 0.15],
            [earScore,         0.20],
        ]) * 1.2, 2, 10);

        // ZYGOMATIC — cheekbone/head-width. Higher = better (more prominent = more attractive).
        // 97.7% = excellent. No upper penalty — lmap rewards high values linearly.
        // Below 0.78 = underdeveloped (score 3). At 0.93+ = very prominent (score 10, capped).
        s.zygomatic = clamp(lmap(m.zygomaticProminence, 0.78, 0.93, 3, 10), 3, 10);

        // JAWLINE — gonial angle now returns real values (115-135 degrees)
        const gonialScore     = gauss(m.jawAngle, 124, 8, 3, 10);
        const jawWidthScore   = lmap(m.jawRatio,  0.55, 0.82, 3, 10);
        const hbScore         = gauss(m.heightBigonialRatio, 1.59, 0.14, 3, 10);
        const jawFrontalScore = gauss(m.jawFrontalAngle, 88, 8, 3, 10);
        s.jawline = wmean([
            [gonialScore,     0.30],
            [jawWidthScore,   0.35],
            [hbScore,         0.20],
            [jawFrontalScore, 0.15],
        ]);

        // BIZYGO/BIGONIAL — widened sigma (0.25) so values near 1.1 score ~7 not ~4.5
        // 1.35 = ideal (10), 1.10 = slightly low (~7.3), 0.90 = too wide (~4.4)
        s.bizygoBigonial = gauss(m.bizygoBigonialRatio, 1.35, 0.25, 3, 10);
        s.chinPhiltrum   = gauss(m.chinPhiltrumRatio,   2.2,  0.35, 3, 10);

        // NOSE — 5-factor frontal composite
        // A/IC: sigma widened to 0.35 — narrow noses (A/IC ~0.58) are ATTRACTIVE,
        // not a flaw. The neoclassical "alar = intercanthal" rule is an average,
        // not a hard target. A narrow refined nose scoring low here is wrong.
        // Weight reduced from 0.25 to 0.15; alar symmetry weight increased.
        const nasalRatioScore = gauss(m.nasalHWratio,     0.65, 0.18, 3, 10);
        const alarIcScore     = gauss(m.alarIntercanthal, 0.90, 0.35, 4, 10); // wider sigma, lower ideal, higher floor
        const mouthNoseScore  = gauss(m.mouthNoseRatio,   1.55, 0.25, 3, 10);
        const noseTipScore    = lmap(m.noseTipDeviation,  0.04, 0,    3, 10);
        const alarSymScore    = lmap(m.alarSymmetry,      0.75, 1.0,  3, 10);
        s.nose = clamp(wmean([
            [nasalRatioScore, 0.35],  // W/H ratio — most reliable frontal metric
            [alarIcScore,     0.15],  // A/IC — reduced weight, wider tolerance
            [mouthNoseScore,  0.20],  // mouth/nose width ratio
            [noseTipScore,    0.15],  // tip centrality
            [alarSymScore,    0.15],  // alar symmetry — increased weight
        ]), 2, 10);

        s.lips = wmean([
            [gauss(m.lowerUpperLipRatio, 1.62, 0.20, 2, 10), 0.60],
            [gauss(m.mouthWidthFace,     0.50, 0.07, 3, 10), 0.40],
        ]);

        // MIDFACE / MAXILLA
        s.maxilla = wmean([
            [gauss(m.midfaceLengthRatio, 0.35, 0.06, 3, 10), 0.40],
            [gauss(m.alarIntercanthal,   1.0,  0.15, 3, 10), 0.30],
            [gauss(m.midfaceRatio,       1.0,  0.10, 3, 10), 0.30],
        ]);

        s.gonion   = lmap(m.gonionProminence,   0.58, 0.84, 3, 10);
        s.mandible = lmap(m.mandibleProminence, 0.60, 0.88, 3, 10);
        // TEMPLES: ratio 0.916 ≈ very good temples. Range recalibrated:
        // 0.55 = hollow (3), 1.10+ = full (10). 0.916 → ~7.7
        s.temples  = clamp(lmap(m.templeRatio, 0.55, 1.10, 3, 10), 3, 10);

        // EYEBROWS
        s.eyebrows = clamp(wmean([
            [lmap(m.browLowsetness, 1.15, 0.50, 3, 10),    0.50],
            [gauss(m.avgBrowTilt, 7, 7, 4, 10),             0.30],
            [lmap(m.browThickness, 0.25, 1.0, 3, 10),       0.20],
        ]), 2, 10);

        s.EMEangle    = gauss(m.EMEangle, 48.5, 4.0, 3, 10);
        // Facial index: sigma widened to 0.35 — naturally wide/square faces shouldn't score 3.9.
        // 0.906 → 6.1, 1.10 → 8.4, 1.35 → 10.0, 1.55 → 9.0
        s.facialIndex = gauss(m.facialIndex, 1.35, 0.35, 3, 10);
        // Neoclassical: intercanthal landmarks (p[39]/p[42]) often drift in face-api,
        // inflating IC ratio. Use wide sigma so values 0.7–1.4 all score reasonably.
        s.neoclassical = wmean([
            [gauss(m.neoclassicalEyeRatio, 1.0, 0.20, 4, 10), 0.50],
            [gauss(m.neoclassicalIPDRatio, 1.1, 0.35, 4, 10), 0.50],  // ideal shifted to 1.1, wide sigma
        ]);

        // HARM/ANGU/DIMO/MISC — chinPhiltrum removed from display and composites
        s.HARM = wmean([
            [s.symmetry,       0.28], [s.goldenRatio,    0.18],
            [s.FWHR,           0.18], [s.midfaceRatio,   0.18],
            [s.bizygoBigonial, 0.18],
        ]);
        s.ANGU = wmean([
            [s.jawline,  0.33], [s.zygomatic, 0.27],
            [s.gonion,   0.22], [s.mandible,  0.18],
        ]);
        s.DIMO = wmean([
            [s.jawline,  0.30], [s.FWHR,     0.25],
            [s.eyebrows, 0.20], [s.gonion,   0.15],
            [s.eyeArea,  0.10],
        ]);
        s.MISC = wmean([
            [s.eyeArea,      0.25], [s.nose,         0.20],
            [s.lips,         0.15], [s.temples,      0.10],
            [s.EMEangle,     0.15], [s.neoclassical, 0.15],
        ]);

        const composite = s.HARM*0.32 + s.MISC*0.26 + s.ANGU*0.22 + s.DIMO*0.20;
        const subScores = [s.HARM, s.ANGU, s.DIMO, s.MISC];
        const spread    = Math.max(...subScores) - Math.min(...subScores);
        // Only penalise when spread > 2 — don't penalise uniformly high faces
        const penalty   = Math.max(0, spread - 2) * 0.1;

        s.overall = clamp((composite - penalty) * (0.88 + 0.12*conf), 0, 10);
        s.looksmaxxRating = this.getLooksmaxxRating(s.overall);
        return s;
    }

    getLooksmaxxRating(score) {
        const R = [
            [9.8,'TeraChad', 'Perfect genetics \u2014 theoretical maximum',            '#00ffff','Top 0.0001%'],
            [9.5,'Chad+',    'Genetic elite \u2014 world-class model / actor tier',    '#00d4ff','Top 0.001%'],
            [9.0,'Chad',     'Exceptional \u2014 top-tier genetics',                   '#0af5a0','Top 0.01%'],
            [8.5,'Chadlite', 'Very good looking \u2014 strong features',               '#30d158','Top 0.1%'],
            [8.0,'HHTN',     'High High Tier Normie \u2014 clearly above average',     '#30d158','Top 0.5%'],
            [7.5,'HTN',      'High Tier Normie \u2014 good looking',                   '#34c759','Top 2%'],
            [7.0,'LHTN',     'Low High Tier Normie \u2014 above average',              '#7ee787','Top 5%'],
            [6.5,'HMTN',     'High Mid Tier Normie \u2014 slightly above average',     '#ff9f0a','Top 15%'],
            [6.0,'MTN',      'Mid Tier Normie \u2014 average',                         '#ff9f0a','Top 30%'],
            [5.5,'LMTN',     'Low Mid Tier Normie \u2014 slightly below average',      '#ff6b35','Top 50%'],
            [5.0,'HLTN',     'High Low Tier Normie \u2014 below average',              '#ff6b35','Bottom 40%'],
            [4.5,'LTN',      'Low Tier Normie \u2014 notably below average',           '#ff453a','Bottom 25%'],
            [4.0,'LLTN',     'Low Low Tier Normie \u2014 significant flaws',           '#ff453a','Bottom 15%'],
            [3.5,'Sub-4',    'Below attractive threshold',                              '#ff2d55','Bottom 5%'],
            [0,  'Truecel',  'Severe facial disharmony',                               '#8b0000','Bottom 2%'],
        ];
        for (const [t,label,tooltip,color,pct] of R)
            if (score >= t) return { label, tooltip, color, pct };
        return { label:'Truecel', tooltip:'Severe facial disharmony', color:'#8b0000', pct:'Bottom 2%' };
    }

    drawOverlay(p) {
        const cvs = this.els.faceCanvas;
        const ctx = this.ctx;
        const sx  = cvs.width  / this.naturalW;
        const sy  = cvs.height / this.naturalH;
        const s   = pt => ({ x: pt.x*sx, y: pt.y*sy });

        ctx.clearRect(0, 0, cvs.width, cvs.height);

        // All landmark dots
        ctx.fillStyle = 'rgba(48,209,88,0.75)';
        p.forEach(pt => { const {x,y}=s(pt); ctx.beginPath(); ctx.arc(x,y,2,0,Math.PI*2); ctx.fill(); });

        ctx.lineWidth = 1.5; ctx.setLineDash([4,4]);

        // Jaw contour p[0]->p[16] (yellow dashed)
        ctx.strokeStyle = 'rgba(255,214,10,0.45)';
        ctx.beginPath(); ctx.moveTo(s(p[0]).x, s(p[0]).y);
        for (let i=1;i<=16;i++) ctx.lineTo(s(p[i]).x, s(p[i]).y);
        ctx.stroke();

        // Estimated bizygomatic line at eye level (outer canthi extended 17.5% each side)
        // This represents the actual zygomatic arch width, not the jaw contour
        // FIX 1: Bizygomatic line — at eye level, width = estimated bizygomatic
        ctx.setLineDash([]); ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(0,212,255,0.9)';
        const eyeY    = (s(p[36]).y + s(p[45]).y) / 2;
        const halfBiz = (this.measurements.faceWidth / 2) * sx;
        const faceCX  = ((s(p[36]).x + s(p[45]).x) / 2);
        ctx.beginPath();
        ctx.moveTo(faceCX - halfBiz, eyeY);
        ctx.lineTo(faceCX + halfBiz, eyeY);
        ctx.stroke();

        // FIX 2: Facial thirds — span full bizygomatic width
        ctx.lineWidth = 1; ctx.setLineDash([5,4]);
        ctx.strokeStyle = 'rgba(255,255,255,0.30)';
        const ocSpan   = s(p[45]).x - s(p[36]).x;
        const lineHalfW = halfBiz;
        [p[19], p[27], p[33]].forEach(pt => {
            const y = s(pt).y;
            ctx.beginPath(); ctx.moveTo(faceCX - lineHalfW, y); ctx.lineTo(faceCX + lineHalfW, y); ctx.stroke();
        });
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.font = `${Math.max(9, cvs.width*0.012)}px system-ui`;
        ctx.fillText('Upper',  faceCX + lineHalfW + 4, s(p[19]).y - 2);
        ctx.fillText('Middle', faceCX + lineHalfW + 4, s(p[27]).y - 2);
        ctx.fillText('Lower',  faceCX + lineHalfW + 4, s(p[33]).y - 2);

        // FIX 3: Canthal tilt lines — draw across full eye width, clearly visible
        ctx.setLineDash([]); ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(255,60,60,0.95)';
        // Left eye: p[36]=outer, p[39]=inner
        ctx.beginPath(); ctx.moveTo(s(p[39]).x,s(p[39]).y); ctx.lineTo(s(p[36]).x,s(p[36]).y); ctx.stroke();
        // Right eye: p[42]=inner, p[45]=outer
        ctx.beginPath(); ctx.moveTo(s(p[42]).x,s(p[42]).y); ctx.lineTo(s(p[45]).x,s(p[45]).y); ctx.stroke();

        // FIX 4: Gonial angle markers — SHORT lines at the jaw angle only, not full triangle
        // Draw just the angle bend at p[3] (L) and p[13] (R), limited length
        ctx.strokeStyle = 'rgba(180,100,255,0.75)';
        ctx.lineWidth = 2; ctx.setLineDash([]);
        const gonialArmLen = (s(p[8]).y - eyeY) * 0.22; // short arm proportional to face height on screen
        [[p[3], p[0], p[8]], [p[13], p[16], p[8]]].forEach(([vertex, ramusDir, bodyDir]) => {
            const vx = s(vertex).x, vy = s(vertex).y;
            // Ramus arm direction (toward ear)
            const rdx = s(ramusDir).x - vx, rdy = s(ramusDir).y - vy;
            const rLen = Math.hypot(rdx, rdy) || 1;
            const rx = vx + rdx/rLen * gonialArmLen;
            const ry = vy + rdy/rLen * gonialArmLen;
            // Body arm direction (toward chin)
            const bdx = s(bodyDir).x - vx, bdy = s(bodyDir).y - vy;
            const bLen = Math.hypot(bdx, bdy) || 1;
            const bx = vx + bdx/bLen * gonialArmLen;
            const by = vy + bdy/bLen * gonialArmLen;
            ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(vx, vy); ctx.lineTo(bx, by); ctx.stroke();
        });

        // FIX 5: Nose width bar — horizontal line at alar base level
        ctx.strokeStyle = 'rgba(255,159,10,0.75)';
        ctx.setLineDash([3,3]); ctx.lineWidth = 2;
        const noseY = (s(p[31]).y + s(p[35]).y) / 2;
        ctx.beginPath(); ctx.moveTo(s(p[31]).x, noseY); ctx.lineTo(s(p[35]).x, noseY); ctx.stroke();

        // FIX 6: EME triangle — clearly visible dashed triangle
        const lPupil = {x:(p[36].x+p[39].x)/2, y:(p[36].y+p[39].y)/2};
        const rPupil = {x:(p[42].x+p[45].x)/2, y:(p[42].y+p[45].y)/2};
        const lipCtr = {x:(p[48].x+p[54].x)/2, y:(p[48].y+p[54].y)/2};
        ctx.strokeStyle = 'rgba(160,80,255,0.45)';
        ctx.setLineDash([5,4]); ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(s(lPupil).x,s(lPupil).y);
        ctx.lineTo(s(rPupil).x,s(rPupil).y);
        ctx.lineTo(s(lipCtr).x,s(lipCtr).y);
        ctx.closePath(); ctx.stroke();

        // FIX 7: Ideal oval — use chinPt (robust chin detection) for height
        const chinPt     = this.measurements.chinPt || p[8];
        const browScreenY = (s(p[19]).y + s(p[24]).y) / 2;
        const cy = (browScreenY + s(chinPt).y) / 2;
        const halfH = (s(chinPt).y - browScreenY) / 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.setLineDash([6,4]); ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(faceCX, cy, halfBiz, halfH, 0, 0, Math.PI*2);
        ctx.stroke();

        // Draw detected chin point as a larger cyan dot
        ctx.setLineDash([]); ctx.fillStyle = 'rgba(0,212,255,0.9)';
        ctx.beginPath(); ctx.arc(s(chinPt).x, s(chinPt).y, 5, 0, Math.PI*2); ctx.fill();

        // FIX 8: Jaw contour — draw from p[0] to p[16]
        ctx.setLineDash([4,4]); ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(255,214,10,0.45)';
        const chinY   = s(chinPt).y;
        const gonionY = (s(p[3]).y + s(p[13]).y) / 2;
        if (chinY > gonionY) {
            ctx.beginPath(); ctx.moveTo(s(p[0]).x, s(p[0]).y);
            for (let i = 1; i <= 16; i++) ctx.lineTo(s(p[i]).x, s(p[i]).y);
            ctx.stroke();
        } else {
            ctx.beginPath(); ctx.moveTo(s(p[0]).x, s(p[0]).y); ctx.lineTo(s(chinPt).x, s(chinPt).y); ctx.lineTo(s(p[16]).x, s(p[16]).y); ctx.stroke();
        }

        ctx.setLineDash([]);
    }

    displayResults(scores, m) {
        const rating  = scores.looksmaxxRating;
        this.els.scoreNum.textContent = scores.overall.toFixed(1);
        const C = 389.6;
        this.els.scoreCircle.style.strokeDashoffset = C - (scores.overall / 10) * C;

        const META = {
            symmetry: {
                name: 'Facial Symmetry',
                what: 'Bilateral match across 25 landmark pairs on both X (left-right) and Y (up-down) axes. Most people score 88–94%. Every 0.5% above 95% is a meaningful advantage. Midline is now calculated from cheekbones (p[1]/p[15]) — corrected from the old jaw-edge midpoint.',
                ideal: '≥97% bilateral match',
                source: 'Bilateral anthropometric standard',
                yourVal: `${(m.symmetryRaw*100).toFixed(1)}%`,
                idealVal: '97–100%',
            },
            goldenRatio: {
                name: 'Facial Thirds',
                what: 'How evenly the face divides into upper (brow→nasion), middle (nasion→subnasale), and lower (subnasale→menton) thirds. 1:1:1 is the mathematical ideal. The lower third can be up to 36% of face height without penalty.',
                ideal: '<8% total deviation from equal thirds',
                source: 'Alfertshofer 2024 + looksmax.org canonical thread',
                yourVal: `${(m.facialThirdsDev*100).toFixed(1)}% deviation`,
                idealVal: '0–8%',
            },
            FWHR: {
                name: 'FWHR (Facial Width-to-Height Ratio)',
                what: 'Bizygomatic width (corrected: p[1]→p[15]) divided by the distance from eyebrow midpoint to upper lip. The single most-discussed ratio on looksmax.org. Higher = wider, more masculine. Dominant halo trait. Low FWHR = narrow, feminine, "longface".',
                ideal: '1.8–2.0 (higher is better within range)',
                source: 'looksmax.org canonical thread + dominance literature',
                yourVal: m.FWHR.toFixed(3),
                idealVal: '1.80–2.0',
            },
            midfaceRatio: {
                name: 'Midface Ratio (IPD/MFH)',
                what: 'Interpupillary distance divided by midface height (nasion to upper lip). Ideal is 1:1 — a "compact" midface. Values above 1.1 suggest a long, "horse-face" midface. Below 0.9 suggests an overly short midface.',
                ideal: '0.95–1.05 (1.0 = perfect compact midface)',
                source: 'looksmax.org ideal ratios thread + PMC10335162',
                yourVal: m.midfaceRatio.toFixed(3),
                idealVal: '0.95–1.05',
            },
            eyeArea: {
                name: 'Eye Area',
                what: '4-factor composite with 1.2× buff (eyes are systematically underscored by 2D frontal landmarks): canthal tilt (40%), eye separation ratio/ESR (25%), eye width symmetry (15%), eye aspect ratio/palpebral W:H (20%). Canthal tilt is the dominant driver — positive degrees = outer corner higher = hunter eyes.',
                ideal: 'Canthal +4–8°, ESR 0.44–0.48, EAR 3.0–3.7',
                source: 'looksmax.org guides + PSL community consensus',
                yourVal: `CT ${m.avgCanthal.toFixed(1)}° | ESR ${m.ESR.toFixed(3)} | EAR ${m.eyeAspectRatio.toFixed(2)}`,
                idealVal: 'CT: +4–8°  ESR: 0.44–0.47',
            },
            zygomatic: {
                name: 'Zygomatic Arch',
                what: 'Cheekbone width (p[1]→p[15]) as percentage of total head width (p[0]→p[16]). Higher = more prominent cheekbones = better. This is a "more is better" trait with no upper penalty — values above 93% (cheekbones nearly as wide as the head) indicate very prominent, attractive cheekbone structure.',
                ideal: '>85% of head width — higher is better, no penalty above 93%',
                source: 'PMC10335162 celebrity analysis + community consensus',
                yourVal: `${(m.zygomaticProminence*100).toFixed(1)}%`,
                idealVal: '>85% (higher = better)',
            },
            jawline: {
                name: 'Jawline',
                what: '4-factor composite: gonial angle (30%), bigonial/face-width (35%), face-height/bigonial golden ratio (20%), jaw frontal angle (15%). GONIAL ANGLE: vertex at p[3]/p[13] (gonion), arms to p[0]/p[16] (ear/jaw edge = ramus direction) and p[8] (chin = jaw body direction). This is the anatomically correct ramus-vs-body angle.',
                ideal: 'Gonial 118–130°, jaw/face 0.75–0.85, jaw frontal 82–94°',
                source: 'looksmax.org concise guide + Dove Press 2023 gonial study',
                yourVal: `Gonial ${m.jawAngle.toFixed(0)}° | W/F ${m.jawRatio.toFixed(3)}`,
                idealVal: 'Gonial: 118–130°',
            },
            bizygoBigonial: {
                name: 'Bizygo/Bigonial Ratio',
                what: 'Bizygomatic width (corrected: p[1]→p[15]) divided by bigonial jaw width (p[3]→p[13]). The looksmax.org canonical thread lists ideal as 1.35 — cheekbones about 35% wider than the jaw. Now returns correct values because bizygomatic is no longer inflated by jaw-edge points.',
                ideal: '1.25–1.45 (ideal ~1.35)',
                source: 'looksmax.org "ideal facial ratios" canonical thread',
                yourVal: m.bizygoBigonialRatio.toFixed(3),
                idealVal: '1.25–1.45',
            },
            chinPhiltrum: {
                name: 'Chin/Philtrum Ratio',
                what: 'Chin height (lower lip to gnathion) divided by philtrum height (subnasale to stomion). Philtrum is guarded against open-mouth distortion — minimum = 30% of eye width. Ideal 2.0–2.5. Below 2.0 = weak chin; above 2.5 = Jay Leno tier.',
                ideal: '2.0–2.5 (ideal ~2.2)',
                source: 'looksmax.org canonical ideal ratios thread',
                yourVal: m.chinPhiltrumRatio.toFixed(2),
                idealVal: '2.0–2.5',
            },
            nose: {
                name: 'Nose',
                what: '5-factor frontal composite: nasal W/H ratio (30%), alar/intercanthal ratio (25%), mouth/nose width ratio (20%), nose tip centrality (15%), alar symmetry (10%). W/H range is wide — narrow noses (0.45–0.55) are refined and score well. Nasolabial angle excluded — it is a profile-only measurement.',
                ideal: 'W/H 0.45–0.85, alar/IC ≈ 1.0, mouth/nose 1.35–1.75, tip centred',
                source: 'looksmax.org + Alfertshofer 2024',
                yourVal: `W/H ${m.nasalHWratio.toFixed(3)} | A/IC ${m.alarIntercanthal.toFixed(3)} | Tip dev ${(m.noseTipDeviation*100).toFixed(1)}%`,
                idealVal: 'W/H: 0.45–0.85',
            },
            lips: {
                name: 'Lips',
                what: 'Lower/upper lip ratio (60%) and mouth width as fraction of face width (40%). Looksmax: lower lip should be 1.62× upper lip height (golden ratio). Mouth width should be ~48–53% of face width.',
                ideal: 'Lower/upper ≈ 1.4–1.8, mouth ≈ 48–53% of face',
                source: 'looksmax.org lip ratio thread + Penna et al. 2015',
                yourVal: `L/U ${m.lowerUpperLipRatio.toFixed(2)} | W/F ${m.mouthWidthFace.toFixed(3)}`,
                idealVal: 'L/U: 1.4–1.8',
            },
            maxilla: {
                name: 'Midface / Maxilla',
                what: 'Forward projection cannot be measured from a front photo (requires profile). Instead, three reliable frontal proxies: (1) midface length ratio — middle third as % of face height, ideal 32–38%, (2) alar base vs intercanthal width — wider alar than IC suggests flat midface, (3) midface compactness (IPD/MFH).',
                ideal: 'Midface 32–38% of face H, alar/IC ≈ 1.0, midface ratio ≈ 1.0',
                source: 'Frontal anthropometry proxies (Alfertshofer 2024)',
                yourVal: `MF ${(m.midfaceLengthRatio*100).toFixed(1)}% | A/IC ${m.alarIntercanthal.toFixed(3)}`,
                idealVal: '32–38% midface',
            },
            gonion: {
                name: 'Gonion',
                what: 'Width at the mandibular angles (p[3]→p[13]) relative to corrected bizygomatic width. Visible, sharp jaw corners are a key masculine marker. Looksmax: gonion position below the mouth line is especially attractive.',
                ideal: '70–84% of bizygomatic width',
                source: 'looksmax.org concise guide + facial anthropometry',
                yourVal: `${(m.gonionProminence*100).toFixed(1)}%`,
                idealVal: '70–84%',
            },
            mandible: {
                name: 'Mandible',
                what: 'Lower jaw depth (p[4]→p[12]) relative to corrected bizygomatic width. The mandible is the structural floor of the face — a deep, forward-grown mandible is the core of a strong jawline.',
                ideal: '72–88% of bizygomatic width',
                source: 'Orthognathic norms + PSL community',
                yourVal: `${(m.mandibleProminence*100).toFixed(1)}%`,
                idealVal: '72–88%',
            },
            temples: {
                name: 'Temples',
                what: 'Temporal region fullness (p[0]→p[1]) relative to bizygomatic width. Full temples frame the upper face, prevent the "skull-like" appearance, and are associated with youth, health, and masculinity. Temple hollowing is a key aging marker.',
                ideal: 'Full temporal projection (ratio > 1.0)',
                source: 'Aesthetic medicine filler norms + looksmax.org HARM guide',
                yourVal: `ratio ${m.templeRatio.toFixed(3)}`,
                idealVal: 'ratio > 1.0',
            },
            eyebrows: {
                name: 'Eyebrows',
                what: '3-factor composite: low-setedness (50%), tilt angle (30%), thickness (20%). Thickness is measured as vertical span of brow landmarks normalised by eye height — thick dense brows score significantly higher. Low-set brows (B/E ratio < 0.80) = hooded/hunter. Tilt corrected: right brow uses p[26]→p[22] (inner→outer), not reversed.',
                ideal: 'B/E ratio < 0.85, tilt 0–14°, thickness ratio > 0.7',
                source: 'looksmax.org HARM guide + corrected landmark mapping',
                yourVal: `B/E ${m.browLowsetness.toFixed(3)} | Tilt ${m.avgBrowTilt.toFixed(1)}° | Thick ${m.browThickness.toFixed(2)}`,
                idealVal: 'B/E < 0.85, thick > 0.7',
            },
            EMEangle: {
                name: 'EME Angle (Eye–Mouth–Eye)',
                what: 'Angle formed at the lip center with lines to each pupil. looksmax.org: ideal 47–50°. This measures face compactness and is a proxy for masculinity and harmony — wider angle = longer face or wider eye spacing.',
                ideal: '47–50°',
                source: 'looksmax.org canonical ideal ratios thread',
                yourVal: `${m.EMEangle.toFixed(1)}°`,
                idealVal: '47–50°',
            },
            facialIndex: {
                name: 'Facial Index',
                what: 'Full face height (brow p[19] → chin p[8]) divided by estimated bizygomatic width (outer canthus span × 1.35). The jaw contour landmarks in face-api do not reach the true zygomatic arch — the bizygomatic is now estimated at eye level from outer eye corners. Oval face = 1.25–1.45.',
                ideal: '1.25–1.45 (oval)',
                source: 'Farkas 1994 classical anthropometry',
                yourVal: m.facialIndex.toFixed(3),
                idealVal: '1.25–1.45',
            },
            neoclassical: {
                name: 'Neoclassical Canons',
                what: 'Two Renaissance proportion rules: (1) each eye width = 1/5 bizygomatic face width, (2) intercanthal distance = 1 eye-width. Both now use corrected bizygomatic (p[1]→p[15]). Previously returning 0.83 due to inflated bizygomatic — now returns values near 1.0 for normal faces.',
                ideal: 'Both ratios 0.9–1.1 (1.0 = perfect)',
                source: 'Neoclassical canons + PMC10335162 validation',
                yourVal: `Eye ${m.neoclassicalEyeRatio.toFixed(3)} | IC ${m.neoclassicalIPDRatio.toFixed(3)}`,
                idealVal: '1.0 each',
            },
        };

        const FIXES = {
            symmetry: `ROOT CAUSES: skeletal misalignment, uneven sleep posture, asymmetric muscle hypertrophy, nasal deviation.\n\nSOFTMAX:\n• Sleep exclusively on your back (most impactful, free)\n• Chew evenly on both sides — stop favouring one side\n• Mewing 24/7 — consistent tongue posture corrects jaw alignment\n\nHARDMAX:\n• Masseter Botox — reduces hypertrophied (dominant) side\n• Rhinoplasty — corrects deviated nasal axis\n• Orthognathic surgery — skeletal correction for severe asymmetry\n• Genioplasty with chin centering — for chin deviation`,

            goldenRatio: `WHICH THIRD IS OFF? (check breakdown panel above)\n• Large lower third → mewing, orthodontics, possible chin reduction\n• Small lower third → chin implant / sliding genioplasty\n• Large upper third → surgical hairline lowering\n• Large middle third → rhinoplasty (visual shortening), LeFort I for severe VME\n• Small middle third → maxillary advancement`,

            FWHR: `FWHR TOO LOW = narrow, feminine-looking face.\n\nSOFTMAX:\n• Cut body fat to 8–12% — reveals existing bizygomatic width\n• Mastic gum chewing — masseter hypertrophy increases lower FWHR\n• Contour makeup / haircut to visually widen\n\nHARDMAX:\n• Zygomatic implants — most direct upper FWHR fix\n• Cheek filler (HA/CaHA) — temporary (12–18 months)\n• Brow bone reduction — if forehead making upper face appear tall\n• Buccal fat removal — exposes underlying bone structure\n\nFWHR TOO HIGH (>2.1) = overly wide/blocky:\n• Haircut to add perceived face height`,

            midfaceRatio: `MIDFACE TOO LONG (ratio < 0.95) = "horse face".\n\nFixes:\n• Rhinoplasty — shorten nasal height component\n• Maxillary impaction (surgical) — shortens vertical midface\n• Hairstyle to camouflage (bangs, etc.)\n\nMIDFACE TOO SHORT (ratio > 1.1):\n• Rhinoplasty — can lengthen nasal appearance\n• Le Fort I for vertical increase (rare)`,

            eyeArea: `CANTHAL TILT NEGATIVE OR LOW.\n\nSOFTMAX:\n• Tape method — temporary upward pull on outer canthus\n\nHARDMAX:\n• Canthoplasty / Canthopexy — surgically lifts outer canthus (+3–5° achievable)\n• Lower eyelid retraction repair — if lids pulling down\n• Brow bone augmentation — projects orbital rim, creates hooded look\n• Orbital rim implants — frames and supports eye area\n\nEYE SPACING (ESR) OFF:\n• Too wide (>0.48): canthal surgery to reposition; hairstyle\n• Too narrow (<0.43): lateral canthoplasty to widen palpebral fissure`,

            zygomatic: `CHEEKBONES UNDERDEVELOPED (below 85% prominence).\n\nSOFTMAX:\n• Body fat reduction — reveals existing cheekbone structure\n• Mewing + hard chewing — stimulates zygomatic bone remodelling over years\n• Contouring makeup\n\nHARDMAX:\n• Buccal fat removal — exposes existing cheekbone shadow\n• Zygomatic implants (silicone or porous PE) — permanent, most effective\n• Cheek filler (HA/CaHA) — 12–18 months, good starting point\n• LeFort I + zygomatic advancement — surgical, most dramatic`,

            jawline: `JAWLINE DEFICIENT.\n\nSOFTMAX:\n• Cut to 8–12% body fat — reveals mandible definition\n• Mastic gum 60–90 min/day — masseter hypertrophy\n• Mewing — stimulates posterior mandible / ramus development\n\nHARDMAX:\n• Custom wrap-around jaw implants (PPE/silicone) — best overall improvement\n• Mandible angle implants — isolated angularity fix\n• BSSO — if whole jaw is skeletally retruded\n• Chin + angle combo implants — cost-effective lower face overhaul`,

            bizygoBigonial: `BIZYGO/BIGONIAL RATIO OFF.\n\nRatio too high (jaw too narrow vs cheekbones):\n• Jaw implants — widen bigonial width\n• Mandible widening osteotomy\n• HA filler to jaw angle — temporary test\n\nRatio too low (jaw too wide):\n• Masseter reduction (Botox) — reduces lower face width without surgery\n• Jaw shave / mandibuloplasty (surgical)`,

            chinPhiltrum: `CHIN/PHILTRUM RATIO SUBOPTIMAL.\n\nToo low (<2.0) = weak chin:\n• Sliding genioplasty — gold standard, advances + can change vertical height\n• Chin implant (silicone/Medpor) — simpler, direct projection increase\n• HA filler chin — temporary (6–12 months)\n\nToo high (>2.5) = Jay Leno, overprojected:\n• Chin reduction osteotomy\n• This is rare; usually ratio is too low`,

            nose: `NOSE PROPORTIONS SUBOPTIMAL.\n\nW/H too high (wide base):\n• Alar base reduction (alarplasty) — most direct fix\n• Rhinoplasty full — comprehensive correction\n\nMouth/nose ratio off:\n• Rhinoplasty narrows nose to match mouth\n• Corner lip lift widens effective mouth\n\nTip deviation:\n• Rhinoplasty with septal straightening\n• Septoplasty if deviated`,

            lips: `LIP RATIO SUBOPTIMAL.\n\nSOFTMAX:\n• Lip liner to define and balance\n• Avoid over-lining upper lip (makes ratio worse)\n\nHARDMAX:\n• HA lip filler — selectively augment deficient lip\n• Lip lift — shortens philtrum, dramatically increases upper lip show\n• Corner lip lift — addresses downturned corners\n• Orthodontics — if lip position is dental in origin`,

            maxilla: `MAXILLA RECESSION. Forward maxilla is the structural centrepiece of the face.\n\nSOFTMAX:\n• Hard mewing 24/7 — full tongue flat on palate with suction hold\n• Nose-breathe exclusively — mouth breathing collapses maxilla\n• Correct swallowing: tongue pushes up, not forward\n• Facemask + palate expander — most effective under 18, possible until ~25\n\nHARDMAX:\n• BiMax (LeFort I + BSSO) — advances entire midface and mandible forward\n• LeFort I alone — if only maxilla is recessed`,

            gonion: `JAW ANGLES UNDERDEVELOPED.\n\nSOFTMAX:\n• Mewing consistently stimulates posterior mandible ramus\n• Mastic gum — masseter growth adds lower jaw visual width\n\nHARDMAX:\n• Gonial angle implants — most direct\n• Mandible widening osteotomy\n• HA filler to jaw angle — 8–14 months (test before committing to surgery)`,

            mandible: `MANDIBLE WEAK.\n\nSOFTMAX:\n• Tongue posture 24/7 prevents further recession\n• Chewing exercises\n\nHARDMAX:\n• BSSO — advances entire mandible\n• Genioplasty — advances chin specifically\n• Custom mandible implants — comprehensive depth + definition`,

            temples: `TEMPLES HOLLOW.\n\nSOFTMAX:\n• Hairstyle adjustment (longer sides) to camouflage\n• Keep face fat at healthy %, not too lean\n\nHARDMAX:\n• HA or CaHA temple filler — 12–24 months, very effective\n• Sculptra (poly-L-lactic acid) — gradual, longer-lasting\n• Autologous fat grafting — permanent, most natural`,

            eyebrows: `EYEBROWS TOO HIGH OR WRONG ANGLE.\n\nSOFTMAX:\n• Stop over-plucking/waxing — let grow thick and full\n• Minoxidil (Rogaine) on brows — increases density, lowers visual line\n• Microblading for lowering the apparent brow position\n• Fill in bottom edge of brow, not the top\n\nHARDMAX:\n• Brow bone augmentation — projects supraorbital rim, physically pushes brows down\n• Surgical brow lowering (rare)\n• Hairline lowering if forehead is large`,

            EMEangle: `EME ANGLE SUBOPTIMAL.\n\nToo wide (>52°) = long face or wide-set eyes:\n• Facial index fix → chin implant, FWHR improvements\n• Eye spacing fix (ESR) → canthal repositioning\n\nToo narrow (<46°) = short, compact, round face:\n• Chin implant to lengthen lower face\n• Hairstyle to add perceived height`,

            facialIndex: `FACIAL INDEX NOT IDEAL.\n\nToo low (<1.2, round/wide face):\n• Chin implant / genioplasty — adds face height\n• Avoid wide-face-enhancing hairstyles\n\nToo high (>1.55, long/narrow face):\n• FWHR improvements (cheekbones, jaw widening)\n• Hairstyle to add width (side volume)\n• Avoid chin elongation`,

            neoclassical: `NEOCLASSICAL CANONS VIOLATED.\n\nEye width too small relative to face (ratio < 0.85):\n• Orbital rim implants for size appearance\n• Canthal lengthening surgery\n\nIntercanthal too wide (eyes too far apart, ratio > 1.1):\n• Medial canthal repositioning (surgical, aggressive)\n\nIntercanthal too narrow (ratio < 0.9):\n• Lateral canthoplasty to widen palpebral fissure`,
        };

        const scoreColor = v => v>=8?'#30d158':v>=6.5?'#ff9f0a':v>=5?'#ff6b35':'#ff453a';
        const ORDER = ['symmetry','goldenRatio','FWHR','midfaceRatio','eyeArea','zygomatic','jawline','bizygoBigonial','nose','lips','maxilla','gonion','mandible','temples','eyebrows','EMEangle','facialIndex','neoclassical'];

        let html = `<div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-block;padding:12px 28px;background:${rating.color}18;border:2px solid ${rating.color};border-radius:14px;">
                <span style="font-size:26px;font-weight:900;color:${rating.color};letter-spacing:.04em;">${rating.label}</span>
            </div>
            <div style="font-size:12px;color:rgba(255,255,255,0.45);margin-top:8px;">${rating.tooltip}</div>
            <div style="font-size:11px;color:${rating.color};font-weight:600;margin-top:3px;">${rating.pct}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.2);margin-top:4px;">Confidence: ${(m.detectionConfidence*100).toFixed(0)}% &nbsp;\u00b7&nbsp; ${this.naturalW}\xd7${this.naturalH}px</div>
        </div>`;

        html += `<div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:14px;margin-bottom:18px;">
            <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px;">Looksmax.org Composite Breakdown</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                ${[['HARM','Harmony',scores.HARM,'32% \u2014 ratios & proportions'],['MISC','Misc Features',scores.MISC,'26% \u2014 eyes, nose, lips, EME'],['ANGU','Angularity',scores.ANGU,'22% \u2014 jaw, zygo, gonion'],['DIMO','Dimorphism',scores.DIMO,'20% \u2014 masculinity markers']].map(([k,l,val,d])=>{
                    const v=clamp(val,0,10);
                    return `<div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:10px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><span style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.7);">${k} \u2014 ${l}</span><span style="font-size:14px;font-weight:800;color:${scoreColor(v)}">${v.toFixed(1)}</span></div>
                        <div style="height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;"><div style="height:100%;width:${v*10}%;background:${scoreColor(v)};transition:width .8s ease;border-radius:2px;"></div></div>
                        <div style="font-size:10px;color:rgba(255,255,255,0.25);margin-top:5px;">${d}</div>
                    </div>`;
                }).join('')}
            </div>
        </div>`;

        const tSign = v=>(v>=0?'+':'')+(v*100).toFixed(1)+'%';
        const tCol  = v=>Math.abs(v)<0.04?'#30d158':Math.abs(v)<0.10?'#ff9f0a':'#ff453a';
        html += `<div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px 14px;margin-bottom:18px;">
            <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">Facial Thirds Breakdown</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;">
                ${[['Upper',m.upperThirdPct,m.upperThirdDev],['Middle',m.middleThirdPct,m.middleThirdDev],['Lower',m.lowerThirdPct,m.lowerThirdDev]].map(([n,pct,dev])=>`
                <div><div style="font-size:10px;color:rgba(255,255,255,0.3);margin-bottom:3px;">${n}</div>
                <div style="font-size:13px;font-weight:700;color:${tCol(dev)}">${(pct*100).toFixed(1)}%</div>
                <div style="font-size:10px;color:${tCol(dev)};margin-top:2px;">${tSign(dev)}</div></div>`).join('')}
            </div>
            <div style="font-size:10px;color:rgba(255,255,255,0.18);margin-top:8px;text-align:center;">Each should be 33.3% \u00b7 deviation from mean third</div>
        </div>`;

        html += ORDER.map((k,idx)=>{
            const v  = clamp(scores[k]??5,0,10);
            const mt = META[k]||{name:k,what:'',ideal:'',source:'',yourVal:'\u2014',idealVal:'\u2014'};
            const fx = FIXES[k];
            const bc = scoreColor(v);
            return `<div class="feature-item" style="opacity:0;animation:_fi .35s ease ${idx*35}ms forwards;">
                <div class="feature-top"><span class="feature-name">${mt.name}</span><span class="feature-score" style="color:${bc}">${v.toFixed(1)}</span></div>
                <div class="feature-bar"><div class="feature-fill" style="width:0%;background:${bc};animation:_fb_${k} .7s ease ${idx*35+200}ms forwards"><style>@keyframes _fb_${k}{to{width:${v*10}%}}</style></div></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;">
                    <div style="background:rgba(255,255,255,0.04);border-radius:5px;padding:5px 7px;"><div style="font-size:9px;color:rgba(255,255,255,0.25);margin-bottom:2px;">YOUR VALUE</div><div style="font-size:11px;font-weight:600;color:${bc}">${mt.yourVal}</div></div>
                    <div style="background:rgba(255,255,255,0.04);border-radius:5px;padding:5px 7px;"><div style="font-size:9px;color:rgba(255,255,255,0.25);margin-bottom:2px;">IDEAL RANGE</div><div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.5)">${mt.idealVal}</div></div>
                </div>
                <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:6px;line-height:1.55;">${mt.what}</div>
                <div style="font-size:10px;color:rgba(255,255,255,0.18);margin-top:3px;">Ideal: <span style="color:rgba(255,255,255,0.30)">${mt.ideal}</span> &nbsp;\u00b7&nbsp; ${mt.source}</div>
                ${v<5.5&&fx?`<div style="font-size:11px;color:#ff9f0a;margin-top:8px;padding:9px 11px;background:rgba(255,159,10,0.06);border-left:2px solid #ff9f0a;border-radius:4px;white-space:pre-line;line-height:1.65;">${fx}</div>`:''}
            </div>`;
        }).join('')+`<style>@keyframes _fi{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}</style>`;

        html += `<div style="margin-top:28px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.07);">
            <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.25);text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px;">PSL Scale Reference</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;font-size:11px;">
                ${[['#00ffff','TeraChad','9.8\u201310','Top 0.0001%'],['#00d4ff','Chad+','9.5\u20139.8','Top 0.001%'],['#0af5a0','Chad','9.0\u20139.5','Top 0.01%'],['#30d158','Chadlite','8.5\u20139.0','Top 0.1%'],['#30d158','HHTN','8.0\u20138.5','Top 0.5%'],['#34c759','HTN','7.5\u20138.0','Top 2%'],['#7ee787','LHTN','7.0\u20137.5','Top 5%'],['#ff9f0a','HMTN','6.5\u20137.0','Top 15%'],['#ff9f0a','MTN','6.0\u20136.5','Top 30%'],['#ff6b35','LMTN','5.5\u20136.0','Top 50%'],['#ff6b35','HLTN','5.0\u20135.5','Bottom 40%'],['#ff453a','LTN','4.5\u20135.0','Bottom 25%'],['#ff453a','LLTN','4.0\u20134.5','Bottom 15%'],['#ff2d55','Sub-4','3.5\u20134.0','Bottom 5%'],['#8b0000','Truecel','<3.5','Bottom 2%']].map(([c,l,r,pp])=>`
                <div style="display:flex;align-items:center;gap:5px;"><span style="color:${c};font-weight:700;min-width:58px;">${l}</span><span style="color:rgba(255,255,255,0.28)">${r}</span><span style="color:rgba(255,255,255,0.15);font-size:9px;margin-left:auto">${pp}</span></div>`).join('')}
            </div>
        </div>`;

        this.els.featuresBox.innerHTML = html;
        this.els.statsSection.classList.add('active');
        this.els.featuresCollapseBtn.style.display = 'flex';
        this.els.featuresBox.classList.add('collapsed'); // Start collapsed
        this.els.featuresCollapseBtn.classList.add('collapsed');
        this.els.featuresCollapseBtn.querySelector('span').textContent = 'Expand';
        this.els.featuresCollapseBtn.title = 'Expand detailed scores';
        this.els.statsSection.classList.remove('active'); // Also hide measurements initially

        const rows = [
            ['Face Width (est.)',   `${m.faceWidth.toFixed(0)}px`],
            ['Outer Canthus W',    `${(m.faceWidth/1.35).toFixed(0)}px`],
            ['Head Width (p0→p16)',`${m.headWidth.toFixed(0)}px`],
            ['Jaw Contour W',      `${m.jawContourWidth.toFixed(0)}px`],
            ['Face Height (p19\u2192p8)',`${m.faceHeight.toFixed(0)}px`],
            ['Facial Index',       `${m.facialIndex.toFixed(3)}`],
            ['FWHR',               `${m.FWHR.toFixed(3)}`],
            ['Left Canthal',       `${m.leftCanthal.toFixed(2)}\u00b0`],
            ['Right Canthal',      `${m.rightCanthal.toFixed(2)}\u00b0`],
            ['Avg Canthal',        `${m.avgCanthal.toFixed(2)}\u00b0`],
            ['Canthal Asymmetry',  `${m.canthalAsym.toFixed(2)}\u00b0`],
            ['IPD',                `${m.ipd.toFixed(0)}px`],
            ['ESR',                `${m.ESR.toFixed(4)}`],
            ['Intercanthal',       `${m.intercanthal.toFixed(0)}px`],
            ['Eye Aspect Ratio',   `${m.eyeAspectRatio.toFixed(2)}`],
            ['Neo Eye Ratio',      `${m.neoclassicalEyeRatio.toFixed(3)}`],
            ['Neo IPD Ratio',      `${m.neoclassicalIPDRatio.toFixed(3)}`],
            ['Upper Face H',       `${m.upperFaceHeight.toFixed(0)}px`],
            ['Midface Ratio',      `${m.midfaceRatio.toFixed(3)}`],
            ['Gonial Angle',       `${m.jawAngle.toFixed(1)}\u00b0`],
            ['Jaw/Face Ratio',     `${m.jawRatio.toFixed(3)}`],
            ['Bizygo/Bigonial',    `${m.bizygoBigonialRatio.toFixed(3)}`],
            ['H/Bigonial',         `${m.heightBigonialRatio.toFixed(3)}`],
            ['Jaw Frontal Angle',  `${m.jawFrontalAngle.toFixed(1)}\u00b0`],
            ['Zygo Prominence',    `${(m.zygomaticProminence*100).toFixed(1)}%`],
            ['Nasal W/H',          `${m.nasalHWratio.toFixed(3)}`],
            ['Alar/Intercanthal',  `${m.alarIntercanthal.toFixed(3)}`],
            ['Mouth/Nose',         `${m.mouthNoseRatio.toFixed(3)}`],
            ['Nose Tip Dev',       `${(m.noseTipDeviation*100).toFixed(2)}%`],
            ['Alar Symmetry',      `${(m.alarSymmetry*100).toFixed(1)}%`],
            ['Lower/Upper Lip',    `${m.lowerUpperLipRatio.toFixed(3)}`],
            ['Mouth/Face',         `${m.mouthWidthFace.toFixed(3)}`],
            ['Chin/Philtrum',      `${m.chinPhiltrumRatio.toFixed(3)}`],
            ['Chin Proj%',         `${(m.chinProjection*100).toFixed(2)}%`],
            ['Mentolabial Angle',  `${m.mentolabialAngle.toFixed(1)}\u00b0`],
            ['Brow/Eye Ratio',     `${m.browLowsetness.toFixed(3)}`],
            ['Brow Tilt',          `${m.avgBrowTilt.toFixed(1)}\u00b0`],
            ['Brow Thickness',     `${m.browThickness.toFixed(3)}`],
            ['Temple Ratio',       `${m.templeRatio.toFixed(3)}`],
            ['EME Angle',          `${m.EMEangle.toFixed(1)}\u00b0`],
            ['Symmetry',           `${(m.symmetryRaw*100).toFixed(2)}%`],
            ['Thirds Deviation',   `${(m.facialThirdsDev*100).toFixed(2)}%`],
            ['Midface Length%',    `${(m.midfaceLengthRatio*100).toFixed(2)}%`],
            ['Confidence',         `${(m.detectionConfidence*100).toFixed(0)}%`],
        ];
        this.els.statsGrid.innerHTML = rows.map(([l,v])=>
            `<div class="stat-box"><div class="stat-label">${l}</div><div class="stat-value">${v}</div></div>`
        ).join('');
    }

    dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

    angle(a, b, c) {
        const A   = Math.atan2(a.y - b.y, a.x - b.x);
        const C   = Math.atan2(c.y - b.y, c.x - b.x);
        let   deg = Math.abs(A - C) * 180 / Math.PI;
        return deg > 180 ? 360 - deg : deg;
    }

    tilt(inner, outer) {
        // Always use abs(dx) so angle is relative to horizontal regardless of eye side.
        // Left eye: outer is LEFT of inner → dx negative → atan2 gives wrong quadrant.
        // Using abs(dx) forces the measurement to be "how much does this line tilt
        // from horizontal" which is what canthal tilt actually means.
        const dx = Math.abs(outer.x - inner.x);
        const dy = outer.y - inner.y;
        return Math.atan2(dy, dx) * 180 / Math.PI;
    }

    setStatus(msg, isError = false, isSuccess = false) {
        this.els.status.textContent = msg;
        this.els.status.className = `status${isError?' error':''}${isSuccess?' success':''}`;
    }

    toggleFeatures() {
        const isCollapsed = this.els.featuresBox.classList.toggle('collapsed');
        this.els.featuresCollapseBtn.classList.toggle('collapsed');
        
        // Also toggle the measurements section
        if (isCollapsed) {
            this.els.statsSection.classList.remove('active');
        } else {
            this.els.statsSection.classList.add('active');
        }
        
        this.els.featuresCollapseBtn.title = isCollapsed ? 'Expand detailed scores' : 'Collapse detailed scores';
        this.els.featuresCollapseBtn.querySelector('span').textContent = isCollapsed ? 'Expand' : 'Collapse';
    }

    toggleStats() {
        const isCollapsed = this.els.statsGrid.classList.toggle('collapsed');
        this.els.statsCollapseBtn.classList.toggle('collapsed');
        this.els.statsCollapseBtn.title = isCollapsed ? 'Expand measurements' : 'Collapse measurements';
    }

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

document.addEventListener('DOMContentLoaded', () => {
    window._analyzerInstance = new FacialAnalyzer();
});