/**
 * gender.js — Gender-adaptive scoring for FacialAnalyzer
 *
 * HOW TO USE:
 * 1. Download age_gender_model weights from:
 *    https://github.com/justadudewhohacks/face-api.js/tree/master/weights
 *    Files needed:
 *      - age_gender_model-weights_manifest.json
 *      - age_gender_model-shard1
 *    Put both in your ./weights/ folder.
 *
 * 2. Add this script to index.html BEFORE app.js:
 *    <script src="gender.js"></script>
 *
 * 3. This file monkey-patches FacialAnalyzer automatically.
 *    No changes needed to app.js.
 *
 * What it does:
 * - Loads the ageGenderNet model alongside your existing models
 * - Detects gender (male/female) and estimated age for every photo
 * - Swaps in gender-specific ideal values before scoring
 *   (female faces no longer get penalised for low FWHR, soft gonial angle, etc.)
 * - Shows detected gender + age + confidence in the results header
 * - Adds a gender badge next to the PSL rating
 */

/* ─── GENDER-SPECIFIC IDEAL VALUES ──────────────────────────────────
   All values sourced from looksmax.org threads + peer-reviewed literature.
   Male ideals are already in app.js — this file provides the FEMALE set
   and a blending mechanism for low-confidence detections.
────────────────────────────────────────────────────────────────── */
const GENDER_IDEALS = {
    male: {
        // Canthal tilt: males benefit from higher positive tilt (hunter eyes)
        canthal:         { ideal: 6,    sigma: 4.0  },
        // ESR: males: ~0.46
        ESR:             { ideal: 0.46, sigma: 0.030 },
        // FWHR: males ideal 1.85–2.0 (wider, more dominant)
        FWHR:            { ideal: 1.92, sigma: 0.15 },
        // Gonial angle: males prefer sharper jaw
        gonialAngle:     { ideal: 124,  sigma: 7.0  },
        // Facial index: males slightly shorter/wider face
        facialIndex:     { ideal: 1.33, sigma: 0.22 },
        // Chin/philtrum: males benefit from stronger chin
        chinPhiltrum:    { ideal: 2.2,  sigma: 0.30 },
        // Brow low-set: males benefit from lower brows
        browLowMap:      [1.15, 0.50, 3, 10],
        // Brow tilt ideal
        browTilt:        { ideal: 7,    sigma: 7.0  },
        // Nasal W/H: males slightly wider nose is fine
        nasalHW:         { ideal: 0.68, sigma: 0.18 },
        // Bizygo/bigonial
        bizygoBigonial:  { ideal: 1.35, sigma: 0.12 },
        // Lower/upper lip
        lowerUpperLip:   { ideal: 1.62, sigma: 0.20 },
        // Height/bigonial ratio
        heightBigonial:  { ideal: 1.59, sigma: 0.12 },
        // Eye aspect ratio: males ok with slightly narrower eyes
        EAR:             { ideal: 3.25, sigma: 0.45 },
        // Midface ratio
        midfaceRatio:    { ideal: 1.0,  sigma: 0.08 },
        // EME angle: males benefit from more compact face
        EMEangle:        { ideal: 48.5, sigma: 2.5  },
        // Mouth/nose width ratio
        mouthNose:       { ideal: 1.55, sigma: 0.22 },
        // Midfac length
        midfaceLen:      { ideal: 0.35, sigma: 0.05 },
    },
    female: {
        // Canthal tilt: females look good with lower positive tilt
        canthal:         { ideal: 3,    sigma: 4.5  },
        // ESR: females benefit from slightly wider eye spacing
        ESR:             { ideal: 0.47, sigma: 0.030 },
        // FWHR: females ideal 1.55–1.75 (narrower face = more feminine)
        FWHR:            { ideal: 1.65, sigma: 0.14 },
        // Gonial angle: females benefit from softer, more obtuse jaw angle
        gonialAngle:     { ideal: 128,  sigma: 8.0  },
        // Facial index: females look best with slightly longer face
        facialIndex:     { ideal: 1.40, sigma: 0.22 },
        // Chin/philtrum: females benefit from shorter, rounder chin
        chinPhiltrum:    { ideal: 2.0,  sigma: 0.28 },
        // Brow low-set: females benefit from slightly higher brow arch
        browLowMap:      [1.30, 0.65, 3, 10],
        // Brow tilt: females benefit from a more arched brow
        browTilt:        { ideal: 12,   sigma: 6.0  },
        // Nasal W/H: females benefit from narrower nose
        nasalHW:         { ideal: 0.60, sigma: 0.16 },
        // Bizygo/bigonial: females can have wider ratio (more tapered jaw)
        bizygoBigonial:  { ideal: 1.42, sigma: 0.13 },
        // Lower/upper lip: females benefit from slightly fuller upper lip
        lowerUpperLip:   { ideal: 1.45, sigma: 0.20 },
        // Height/bigonial ratio
        heightBigonial:  { ideal: 1.63, sigma: 0.12 },
        // Eye aspect ratio: females score higher with larger, rounder eyes
        EAR:             { ideal: 2.90, sigma: 0.40 },
        // Midface ratio
        midfaceRatio:    { ideal: 1.0,  sigma: 0.10 },
        // EME angle: females ok with slightly wider angle
        EMEangle:        { ideal: 50,   sigma: 3.0  },
        // Mouth/nose width ratio: females benefit from slightly wider mouth
        mouthNose:       { ideal: 1.60, sigma: 0.20 },
        // Midface length
        midfaceLen:      { ideal: 0.34, sigma: 0.05 },
    },
};

/* ─── FEMALE PSL SCALE ───────────────────────────────────────────────
   Females are scored on attractiveness, not masculinity/dominance.
   Labels reflect standard female rating terminology.
────────────────────────────────────────────────────────────────────────── */
const FEMALE_RATING_SCALE = [
    [9.8, 'Goddess',      'Perfect genetics — runway / top model tier',                '#00ffff', 'Top 0.0001%'],
    [9.5, 'Supermodel',   'Genetic elite — Victoria\'s Secret / high fashion tier',    '#00d4ff', 'Top 0.001%'],
    [9.0, 'Very HB',      'Exceptionally beautiful — turns heads constantly',          '#0af5a0', 'Top 0.01%'],
    [8.5, 'HB9',          'Very high tier — clearly model-level features',             '#30d158', 'Top 0.1%'],
    [8.0, 'HB8',          'High tier — very attractive, sought-after',                 '#30d158', 'Top 0.5%'],
    [7.5, 'HB7.5',        'Above average — noticeably attractive',                     '#34c759', 'Top 2%'],
    [7.0, 'HB7',          'Above average — pretty, gets attention',                    '#7ee787', 'Top 5%'],
    [6.5, 'HB6.5',        'Slightly above average',                                    '#ff9f0a', 'Top 15%'],
    [6.0, 'HB6',          'Average — no major strengths or weaknesses',                '#ff9f0a', 'Top 30%'],
    [5.5, 'HB5.5',        'Slightly below average',                                    '#ff6b35', 'Top 50%'],
    [5.0, 'HB5',          'Below average',                                             '#ff6b35', 'Bottom 40%'],
    [4.5, 'HB4.5',        'Notably below average',                                     '#ff453a', 'Bottom 25%'],
    [4.0, 'HB4',          'Significant facial disharmony',                             '#ff453a', 'Bottom 15%'],
    [3.5, 'Sub-4F',       'Major structural deficiencies',                             '#ff2d55', 'Bottom 5%'],
    [0,   'Low',          'Severe disharmony — significant improvement possible',      '#8b0000', 'Bottom 2%'],
];

/* ─── BLEND IDEALS ───────────────────────────────────────────────────
   If gender confidence < 0.70, blend male/female ideals proportionally.
   e.g. 60% male confidence → 60% male ideals + 40% female ideals.
────────────────────────────────────────────────────────────────────────── */
function blendIdeals(genderResult) {
    const { gender, genderProbability } = genderResult;
    const maleConf   = gender === 'male' ? genderProbability : 1 - genderProbability;
    const femaleConf = 1 - maleConf;

    // If confidence >= 0.70 use pure ideals, no blending needed
    if (maleConf >= 0.70)   return { ...GENDER_IDEALS.male,   _gender: 'male',   _conf: maleConf };
    if (femaleConf >= 0.70) return { ...GENDER_IDEALS.female, _gender: 'female', _conf: femaleConf };

    // Blend
    const m = GENDER_IDEALS.male;
    const f = GENDER_IDEALS.female;
    const blend = (a, b) => a * maleConf + b * femaleConf;

    return {
        _gender: 'ambiguous',
        _conf: Math.max(maleConf, femaleConf),
        canthal:        { ideal: blend(m.canthal.ideal, f.canthal.ideal),               sigma: blend(m.canthal.sigma, f.canthal.sigma) },
        ESR:            { ideal: blend(m.ESR.ideal, f.ESR.ideal),                       sigma: blend(m.ESR.sigma, f.ESR.sigma) },
        FWHR:           { ideal: blend(m.FWHR.ideal, f.FWHR.ideal),                     sigma: blend(m.FWHR.sigma, f.FWHR.sigma) },
        gonialAngle:    { ideal: blend(m.gonialAngle.ideal, f.gonialAngle.ideal),       sigma: blend(m.gonialAngle.sigma, f.gonialAngle.sigma) },
        facialIndex:    { ideal: blend(m.facialIndex.ideal, f.facialIndex.ideal),       sigma: blend(m.facialIndex.sigma, f.facialIndex.sigma) },
        chinPhiltrum:   { ideal: blend(m.chinPhiltrum.ideal, f.chinPhiltrum.ideal),     sigma: blend(m.chinPhiltrum.sigma, f.chinPhiltrum.sigma) },
        browLowMap:     m.browLowMap.map((v, i) => blend(v, f.browLowMap[i])),
        browTilt:       { ideal: blend(m.browTilt.ideal, f.browTilt.ideal),             sigma: blend(m.browTilt.sigma, f.browTilt.sigma) },
        nasalHW:        { ideal: blend(m.nasalHW.ideal, f.nasalHW.ideal),               sigma: blend(m.nasalHW.sigma, f.nasalHW.sigma) },
        bizygoBigonial: { ideal: blend(m.bizygoBigonial.ideal, f.bizygoBigonial.ideal), sigma: blend(m.bizygoBigonial.sigma, f.bizygoBigonial.sigma) },
        lowerUpperLip:  { ideal: blend(m.lowerUpperLip.ideal, f.lowerUpperLip.ideal),   sigma: blend(m.lowerUpperLip.sigma, f.lowerUpperLip.sigma) },
        heightBigonial:  { ideal: blend(m.heightBigonial.ideal, f.heightBigonial.ideal), sigma: blend(m.heightBigonial.sigma, f.heightBigonial.sigma) },
        EAR:            { ideal: blend(m.EAR.ideal, f.EAR.ideal),                       sigma: blend(m.EAR.sigma, f.EAR.sigma) },
        midfaceRatio:   { ideal: blend(m.midfaceRatio.ideal, f.midfaceRatio.ideal),     sigma: blend(m.midfaceRatio.sigma, f.midfaceRatio.sigma) },
        EMEangle:       { ideal: blend(m.EMEangle.ideal, f.EMEangle.ideal),             sigma: blend(m.EMEangle.sigma, f.EMEangle.sigma) },
        mouthNose:      { ideal: blend(m.mouthNose.ideal, f.mouthNose.ideal),           sigma: blend(m.mouthNose.sigma, f.mouthNose.sigma) },
        midfaceLen:     { ideal: blend(m.midfaceLen.ideal, f.midfaceLen.ideal),         sigma: blend(m.midfaceLen.sigma, f.midfaceLen.sigma) },
    };
}

/* ═════════════════════════════════════════════════════════════════
   MONKEY-PATCH: runs after DOMContentLoaded, modifies FacialAnalyzer in place
═══════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    // Wait one tick for app.js to instantiate FacialAnalyzer
    setTimeout(() => {
        const analyzer = window._analyzerInstance;
        if (!analyzer) {
            console.warn('[gender.js] Could not find analyzer instance on window._analyzerInstance');
            return;
        }
        patchAnalyzer(analyzer);
    }, 0);
});

function patchAnalyzer(analyzer) {

    /* ── 1. PATCH initModels — load ageGenderNet alongside existing models ── */
    const _origInitModels = analyzer.initModels.bind(analyzer);
    analyzer.initModels = async function () {
        await _origInitModels();
        try {
            await faceapi.nets.ageGenderNet.loadFromUri('./weights');
            this._genderModelLoaded = true;
            console.log('[gender.js] ageGenderNet loaded ✓');
        } catch (e) {
            console.warn('[gender.js] ageGenderNet not found in ./weights — gender detection disabled.\n' +
                'Download from: https://github.com/justadudewhohacks/face-api.js/tree/master/weights\n' +
                'Files: age_gender_model-weights_manifest.json + age_gender_model-shard1');
            this._genderModelLoaded = false;
        }
    };

    /* ── 2. PATCH analyze — run gender detection after face detection ── */
    const _origAnalyze = analyzer.analyze.bind(analyzer);
    analyzer.analyze = async function () {
        // Reset gender state
        this._genderResult = null;
        this._ideals = null;
        await _origAnalyze();
    };

    /* ── 3. PATCH _detect — run gender detection in parallel ── */
    const _origDetect = analyzer._detect.bind(analyzer);
    analyzer._detect = async function () {
        const det = await _origDetect();
        if (!det || !this._genderModelLoaded) return det;

        try {
            this.setLoader('Detecting gender & age…');
            // Run age+gender on the same image
            const withGender = await faceapi
                .detectSingleFace(this.currentImage,
                    this.useTiny
                        ? new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.3 })
                        : new faceapi.SsdMobilenetv1Options({ minConfidenceScore: 0.35 })
                )
                .withFaceLandmarks()
                .withAgeAndGender();

            if (withGender) {
                this._genderResult = {
                    gender:            withGender.gender,
                    genderProbability: withGender.genderProbability,
                    age:               Math.round(withGender.age),
                };
                this._ideals = blendIdeals(this._genderResult);
                console.log(`[gender.js] Detected: ${this._genderResult.gender} ` +
                    `(${(this._genderResult.genderProbability * 100).toFixed(0)}% conf), ` +
                    `age ~${this._genderResult.age}`);
            }
        } catch (e) {
            console.warn('[gender.js] Gender detection failed:', e.message);
        }

        return det;
    };

    /* ── 4. PATCH calculateScores — use gender-specific ideals ── */
    const _origCalcScores = analyzer.calculateScores.bind(analyzer);
    analyzer.calculateScores = function (m) {
        const ideals = this._ideals;
        if (!ideals) return _origCalcScores(m); // no gender detected — use defaults

        // Temporarily override the module-level gauss/lmap constants
        // by passing ideals directly into an overridden score computation
        return _genderAwareScores(m, ideals, _origCalcScores);
    };

    /* ── 5. PATCH displayResults — inject gender badge into header ── */
    const _origDisplay = analyzer.displayResults.bind(analyzer);
    analyzer.displayResults = function (scores, m) {
        _origDisplay(scores, m);

        // Inject gender info into the header block
        const gr = this._genderResult;
        if (!gr) return;

        const genderColor  = gr.gender === 'female' ? '#ff6eb4' : '#5ac8fa';
        const genderLabel  = gr.gender === 'female' ? '♀ Female' : '♂ Male';
        const confPct      = (gr.genderProbability * 100).toFixed(0);
        const ambiguous    = gr.genderProbability < 0.70;
        const badgeTitle   = ambiguous
            ? `Ambiguous (${confPct}% ${gr.gender}) — blended ideals used` 
            : `${gr.gender === 'female' ? 'Female' : 'Male'} (${confPct}% confidence)`;

        // Find the header confidence line and append gender badge
        const headerDiv = this.els.featuresBox.querySelector('[data-gender-badge]');
        if (headerDiv) return; // already injected

        const featuresBox = this.els.featuresBox;
        const firstChild  = featuresBox.firstElementChild;
        if (!firstChild) return;

        const badge = document.createElement('div');
        badge.setAttribute('data-gender-badge', '1');
        badge.style.cssText = `
            display: inline-flex; align-items: center; gap: 8px;
            margin-top: 10px; padding: 6px 14px;
            background: ${genderColor}18; border: 1px solid ${genderColor}60;
            border-radius: 20px; font-size: 12px;
        `;
        badge.innerHTML = `
            <span style="color:${genderColor};font-weight:700;">${genderLabel}</span>
            <span style="color:rgba(255,255,255,0.4);">Age ~${gr.age}</span>
            ${ambiguous ? `<span style="color:#ff9f0a;font-size:10px;" title="${badgeTitle}">⚠ ambiguous</span>` : ''}
            <span style="color:rgba(255,255,255,0.25);font-size:10px;">${confPct}% conf</span>
        `;

        // Insert badge inside the header div (first child)
        const headerInner = firstChild.querySelector('[style*="text-align:center"]') || firstChild;
        headerInner.appendChild(badge);

        // Also patch the PSL rating label for females
        if (gr.gender === 'female' && gr.genderProbability >= 0.70) {
            _patchFemaleRatingLabel(scores.overall, featuresBox);
        }
    };
}

/* ─── GENDER-AWARE SCORE COMPUTATION ─────────────────────────────────────── */
function _genderAwareScores(m, ideals, fallbackFn) {
    // We run the original scorer first to get the structure,
    // then replace the gender-sensitive individual scores in-place.
    const s = fallbackFn(m);

    // Helper (local copies matching app.js)
    const gauss = (v, ideal, sigma, floor, peak) =>
        floor + Math.exp(-0.5 * ((v - ideal) / sigma) ** 2) * (peak - floor);
    const lmap = (v, inL, inH, outL, outH) => {
        const t = (v - inL) / (inH - inL);
        const lo = Math.min(outL, outH), hi = Math.max(outL, outH);
        return Math.min(hi, Math.max(lo, outL + t * (outH - outL)));
    };
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const wmean = pairs => {
        let t = 0, w = 0;
        for (const [v, wt] of pairs) { t += clamp(v, 0, 10) * wt; w += wt; }
        return t / w;
    };

    // Re-compute gender-sensitive scores using blended ideals
    s.FWHR        = gauss(m.FWHR, ideals.FWHR.ideal, ideals.FWHR.sigma, 2, 10);
    s.facialIndex = gauss(m.facialIndex, ideals.facialIndex.ideal, ideals.facialIndex.sigma, 3, 10);
    s.midfaceRatio = gauss(m.midfaceRatio, ideals.midfaceRatio.ideal, ideals.midfaceRatio.sigma, 2, 10);
    s.EMEangle    = gauss(m.EMEangle, ideals.EMEangle.ideal, ideals.EMEangle.sigma, 2, 10);
    s.bizygoBigonial = gauss(m.bizygoBigonialRatio, ideals.bizygoBigonial.ideal, ideals.bizygoBigonial.sigma, 2, 10);
    s.chinPhiltrum = gauss(m.chinPhiltrumRatio, ideals.chinPhiltrum.ideal, ideals.chinPhiltrum.sigma, 2, 10);

    // Eye area with gender-adaptive canthal and EAR
    const ctScore       = gauss(m.avgCanthal, ideals.canthal.ideal, ideals.canthal.sigma, 2, 10);
    const ctAsymPenalty = clamp(m.canthalAsym / 3, 0, 2);
    const esrScore      = gauss(m.ESR, ideals.ESR.ideal, ideals.ESR.sigma, 2, 10);
    const eyeWidthSym   = lmap(m.eyeWidthAsym, 0, 0.15, 10, 2);
    const earScore      = gauss(m.eyeAspectRatio, ideals.EAR.ideal, ideals.EAR.sigma, 3, 10);
    s.eyeArea = clamp(wmean([
        [clamp(ctScore - ctAsymPenalty, 0, 10), 0.40],
        [esrScore,      0.25],
        [eyeWidthSym,   0.15],
        [earScore,      0.20],
    ]) * 1.2, 2, 10);  // keep the 1.2× buff

    // Jawline with gender-adaptive gonial angle
    const gonialScore   = gauss(m.jawAngle, ideals.gonialAngle.ideal, ideals.gonialAngle.sigma, 2, 10);
    const jawWidthScore = lmap(m.jawRatio, 0.55, 0.82, 2, 10);
    const hbScore       = gauss(m.heightBigonialRatio, ideals.heightBigonial.ideal, ideals.heightBigonial.sigma, 2, 10);
    const jawFrontal    = gauss(m.jawFrontalAngle, 88, 7, 2, 10);
    s.jawline = wmean([[gonialScore,0.30],[jawWidthScore,0.35],[hbScore,0.20],[jawFrontal,0.15]]);

    // Eyebrows with gender-adaptive low-set map and tilt
    const [bLow_inL, bLow_inH, bLow_outL, bLow_outH] = ideals.browLowMap;
    const browLowScore   = lmap(m.browLowsetness, bLow_inL, bLow_inH, bLow_outL, bLow_outH);
    const browTiltScore  = gauss(m.avgBrowTilt, ideals.browTilt.ideal, ideals.browTilt.sigma, 4, 10);
    const browThickScore = lmap(m.browThickness, 0.25, 1.0, 3, 10);
    s.eyebrows = clamp(wmean([[browLowScore,0.50],[browTiltScore,0.30],[browThickScore,0.20]]), 2, 10);

    // Nose with gender-adaptive W/H ratio
    const nasalScore  = gauss(m.nasalHWratio, ideals.nasalHW.ideal, ideals.nasalHW.sigma, 3, 10);
    const alarIcScore = gauss(m.alarIntercanthal, 1.0, 0.18, 3, 10);
    const mnScore     = gauss(m.mouthNoseRatio, ideals.mouthNose.ideal, ideals.mouthNose.sigma, 3, 10);
    const tipScore    = lmap(m.noseTipDeviation, 0.04, 0, 3, 10);
    const alarSym     = lmap(m.alarSymmetry, 0.75, 1.0, 3, 10);
    s.nose = clamp(wmean([[nasalScore,0.30],[alarIcScore,0.25],[mnScore,0.20],[tipScore,0.15],[alarSym,0.10]]), 2, 10);

    // Lips with gender-adaptive lower/upper ratio
    const lulScore    = gauss(m.lowerUpperLipRatio, ideals.lowerUpperLip.ideal, ideals.lowerUpperLip.sigma, 2, 10);
    const mwFaceScore = gauss(m.mouthWidthFace, 0.50, 0.05, 2, 10);
    s.lips = wmean([[lulScore, 0.60],[mwFaceScore, 0.40]]);

    // Maxilla with gender-adaptive midface length
    const mlScore  = gauss(m.midfaceLengthRatio, ideals.midfaceLen.ideal, ideals.midfaceLen.sigma, 3, 10);
    const alScore  = gauss(m.alarIntercanthal, 1.0, 0.14, 3, 10);
    const mrScore  = gauss(m.midfaceRatio, ideals.midfaceRatio.ideal, ideals.midfaceRatio.sigma, 3, 10);
    s.maxilla = wmean([[mlScore, 0.40],[alScore, 0.30],[mrScore, 0.30]]);

    // Re-run HARM/ANGU/DIMO/MISC with updated sub-scores
    s.HARM = wmean([
        [s.symmetry,      0.25],
        [s.goldenRatio,   0.15],
        [s.FWHR,          0.15],
        [s.midfaceRatio,  0.15],
        [s.bizygoBigonial,0.15],
        [s.chinPhiltrum, 0.15],
    ]);
    s.ANGU = wmean([
        [s.jawline,      0.30],
        [s.zygomatic,    0.25],
        [s.gonion,       0.20],
        [s.mandible,     0.15],
        [s.chinPhiltrum, 0.10],
    ]);
    s.DIMO = wmean([
        [s.jawline,      0.30],
        [s.FWHR,     0.25],
        [s.eyebrows, 0.20],
        [s.gonion,   0.15],
        [s.eyeArea,  0.10],
    ]);
    s.MISC = wmean([
        [s.eyeArea,      0.25],
        [s.nose,         0.20],
        [s.lips,         0.15],
        [s.temples,      0.10],
        [s.EMEangle,     0.15],
        [s.neoclassical, 0.15],
    ]);

    const composite = s.HARM*0.32 + s.MISC*0.26 + s.ANGU*0.22 + s.DIMO*0.20;
    const subScores = [s.HARM, s.ANGU, s.DIMO, s.MISC];
    const spread    = Math.max(...subScores) - Math.min(...subScores);
    const conf      = clamp(m.detectionConfidence, 0.5, 1);
    s.overall = clamp((composite - spread * 0.1) * (0.88 + 0.12 * conf), 0, 10);

    // Use female PSL scale if female detected with high confidence
    const genderConf = ideals._conf || 0;
    if (ideals._gender === 'female' && genderConf >= 0.70) {
        s.looksmaxxRating = _getFemaleRating(s.overall);
    } else {
        // Keep existing looksmaxxRating from original scorer
    }

    return s;
}

function _getFemaleRating(score) {
    for (const [t, label, tooltip, color, pct] of FEMALE_RATING_SCALE) {
        if (score >= t) return { label, tooltip, color, pct };
    }
    return { label:'Low', tooltip:'Severe disharmony', color:'#8b0000', pct:'Bottom 2%' };
}

function _patchFemaleRatingLabel(score, featuresBox) {
    const rating = _getFemaleRating(score);
    const badge  = featuresBox.querySelector('[style*="font-size:26px"]');
    if (badge) badge.textContent = rating.label;
}

/* ─── EXPOSE ON WINDOW ───────────────────────────────────────────── */
window.GENDER_IDEALS   = GENDER_IDEALS;
window.blendIdeals     = blendIdeals;
