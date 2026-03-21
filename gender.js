/**
 * gender.js — Manual gender selection for FacialAnalyzer
 *
 * When user clicks "Analyze Face", a popup appears asking Male or Female.
 * Female gets: neoteny-based scoring, HB/Stacy scale, female descriptions,
 *              female improvement advice, NEOT composite instead of DIMO.
 * Male gets: standard app.js scoring unchanged.
 */

const GENDER_IDEALS = {
    male: {
        canthal:        { ideal: 6,    sigma: 4.0  },
        ESR:            { ideal: 0.46, sigma: 0.030 },
        FWHR:           { ideal: 1.92, sigma: 0.15 },
        gonialAngle:    { ideal: 124,  sigma: 7.0  },
        facialIndex:    { ideal: 1.33, sigma: 0.22 },
        chinPhiltrum:   { ideal: 2.2,  sigma: 0.30 },
        browLowMap:     [1.15, 0.50, 3, 10],
        browTilt:       { ideal: 7,    sigma: 7.0  },
        nasalHW:        { ideal: 0.68, sigma: 0.18 },
        bizygoBigonial: { ideal: 1.35, sigma: 0.12 },
        lowerUpperLip:  { ideal: 1.62, sigma: 0.20 },
        heightBigonial: { ideal: 1.59, sigma: 0.12 },
        EAR:            { ideal: 3.25, sigma: 0.45 },
        midfaceRatio:   { ideal: 1.0,  sigma: 0.08 },
        EMEangle:       { ideal: 48.5, sigma: 2.5  },
        mouthNose:      { ideal: 1.55, sigma: 0.22 },
        midfaceLen:     { ideal: 0.35, sigma: 0.05 },
    },
    female: {
        canthal:        { ideal: 4,    sigma: 5.0  },
        ESR:            { ideal: 0.48, sigma: 0.032 },
        FWHR:           { ideal: 1.65, sigma: 0.14 },
        gonialAngle:    { ideal: 130,  sigma: 9.0  },
        facialIndex:    { ideal: 1.42, sigma: 0.22 },
        chinPhiltrum:   { ideal: 1.9,  sigma: 0.28 },
        browLowMap:     [0.65, 1.30, 3, 10],
        browTilt:       { ideal: 12,   sigma: 6.0  },
        nasalHW:        { ideal: 0.58, sigma: 0.14 },
        bizygoBigonial: { ideal: 1.45, sigma: 0.14 },
        lowerUpperLip:  { ideal: 1.40, sigma: 0.22 },
        heightBigonial: { ideal: 1.65, sigma: 0.13 },
        EAR:            { ideal: 2.85, sigma: 0.38 },
        midfaceRatio:   { ideal: 1.0,  sigma: 0.12 },
        EMEangle:       { ideal: 50,   sigma: 3.5  },
        mouthNose:      { ideal: 1.65, sigma: 0.22 },
        midfaceLen:     { ideal: 0.33, sigma: 0.05 },
    },
};

const FEMALE_RATING_SCALE = [
    [9.8, 'Goddess',    'Perfect genetics \u2014 runway / elite model tier',                '#00ffff', 'Top 0.0001%'],
    [9.5, 'Supermodel', "Genetic elite \u2014 Victoria's Secret / high fashion tier",       '#00d4ff', 'Top 0.001%' ],
    [9.0, 'Stacy+',     'Exceptional \u2014 turns heads universally',                       '#0af5a0', 'Top 0.01%'  ],
    [8.5, 'Stacy',      'Very high tier \u2014 clearly model-level features',               '#30d158', 'Top 0.1%'   ],
    [8.0, 'HB8',        'High tier \u2014 very attractive, significant halo effect',        '#30d158', 'Top 0.5%'   ],
    [7.5, 'HB7.5',      'Above average \u2014 noticeably attractive',                       '#34c759', 'Top 2%'     ],
    [7.0, 'HB7',        'Above average \u2014 pretty, positive first impressions',          '#7ee787', 'Top 5%'     ],
    [6.5, 'HB6.5',      'Slightly above average \u2014 good features, minor weaknesses',    '#ff9f0a', 'Top 15%'    ],
    [6.0, 'Becky',      'Average \u2014 no major strengths or weaknesses',                  '#ff9f0a', 'Top 30%'    ],
    [5.5, 'HB5.5',      'Slightly below average',                                           '#ff6b35', 'Top 50%'    ],
    [5.0, 'HB5',        'Below average \u2014 some notable weaknesses',                     '#ff6b35', 'Bottom 40%' ],
    [4.5, 'HB4.5',      'Notably below average \u2014 multiple weak features',              '#ff453a', 'Bottom 25%' ],
    [4.0, 'HB4',        'Significant facial disharmony',                                    '#ff453a', 'Bottom 15%' ],
    [3.5, 'Sub-4F',     'Major structural deficiencies \u2014 improvement possible',        '#ff2d55', 'Bottom 5%'  ],
    [0,   'Low',        'Severe disharmony \u2014 significant intervention possible',       '#8b0000', 'Bottom 2%'  ],
];

const FEMALE_META = {
    symmetry: {
        name: 'Facial Symmetry',
        what: 'Bilateral match across 25 landmark pairs. Symmetry is equally critical for female attractiveness \u2014 asymmetry reads as unhealthy or stressed. Stacy/HB8+ faces reliably score above 96%.',
        ideal: '\u226597% bilateral match',
        source: 'Bilateral anthropometric standard',
    },
    goldenRatio: {
        name: 'Facial Thirds',
        what: 'Upper (hairline\u2192nasion), middle (nasion\u2192subnasale), lower (subnasale\u2192chin) should each be 33.3%. For females, a slightly shorter lower third (30\u201332%) reads as youthful and neotenous rather than a flaw.',
        ideal: '<8% deviation from equal thirds',
        source: 'Alfertshofer 2024 + looksmax.org female appeal',
    },
    FWHR: {
        name: 'FWHR (Facial Width-to-Height Ratio)',
        what: 'For females, LOWER FWHR is more attractive \u2014 a narrower, oval face reads as feminine. Ideal 1.55\u20131.75. High FWHR (>1.9) looks masculine on females. This is the OPPOSITE of the male ideal.',
        ideal: '1.55\u20131.75 (lower = more feminine)',
        source: 'looksmax.org female appeal + sexual dimorphism literature',
    },
    midfaceRatio: {
        name: 'Midface Ratio (IPD/MFH)',
        what: 'IPD divided by midface height. Ideal 1:1. For females, a slightly longer midface (0.90\u20130.95) is elegant. Very short = babyish; very long = horse-face.',
        ideal: '0.92\u20131.05',
        source: 'looksmax.org + PMC10335162',
    },
    eyeArea: {
        name: 'Eye Area',
        what: 'For females, large open eyes are a PRIMARY neoteny marker \u2014 bigger = more attractive. EAR (eye openness) weighted higher than canthal tilt. Wider spacing (ESR 0.46\u20130.50) is more neotenous. Doe-eyes and almond shape both score well.',
        ideal: 'Large, open, ESR 0.46\u20130.50, slight positive or neutral tilt',
        source: 'looksmax.org female neoteny threads + PSL community',
    },
    zygomatic: {
        name: 'Zygomatic Arch',
        what: 'High cheekbones are universally attractive in females \u2014 one of the strongest halo features. Prominent cheekbones create the ogee curve that defines model faces.',
        ideal: '>85% of head width (higher = better)',
        source: 'PMC10335162 + looksmax.org female appeal',
    },
    jawline: {
        name: 'Jawline',
        what: 'Female jawline ideal is SOFT, not angular. Gonial angle 125\u2013138\u00b0 reads as feminine. Sharp squared jaw angles look masculine. A tapered V-shape jaw is the coveted female ideal.',
        ideal: 'Gonial 125\u2013138\u00b0, soft tapered V-shape',
        source: 'looksmax.org female jaw appeal + orthognathic literature',
    },
    bizygoBigonial: {
        name: 'Bizygo/Bigonial Ratio',
        what: 'For females, HIGHER ratio is better \u2014 cheekbones significantly wider than jaw creates the heart/V-shape face. Ideal ~1.45. Wide jaw vs narrow cheekbones reads as boxy/masculine.',
        ideal: '1.35\u20131.55 (higher = more feminine heart shape)',
        source: 'looksmax.org female face shape + aesthetic surgery standards',
    },
    nose: {
        name: 'Nose',
        what: 'Females strongly benefit from a narrow, refined nose. W/H ratio ideally 0.45\u20130.65. A button nose or thin straight nose is a major attractor. Wide noses are penalised more heavily in female scoring.',
        ideal: 'W/H 0.40\u20130.68, narrow and refined',
        source: 'looksmax.org + rhinoplasty aesthetic standards',
    },
    lips: {
        name: 'Lips',
        what: 'Lips are one of the most important features for female attractiveness. Fuller lips score significantly higher. Ideal lower/upper ratio ~1.4 (more equal volume). Upper lip fullness and defined cupid\'s bow are major attractors.',
        ideal: 'L/U 1.2\u20131.6, full upper lip, defined cupid\'s bow',
        source: 'looksmax.org female lips + Penna et al. 2015',
    },
    maxilla: {
        name: 'Midface / Maxilla',
        what: 'Forward maxilla creates the model midface \u2014 lifted cheeks, no nasolabial hollow, supported under-eye. Frontal proxies: midface length 31\u201337% of face height.',
        ideal: 'Midface 31\u201337%, alar/IC \u22481.0',
        source: 'Alfertshofer 2024 + aesthetic surgery standards',
    },
    gonion: {
        name: 'Gonion',
        what: 'For females, visible jaw angle definition is less important than in males. A smooth, rounded gonion reads as feminine. Very prominent sharp jaw angles look masculine.',
        ideal: '65\u201380% of bizygomatic (softer than male ideal)',
        source: 'looksmax.org female jaw + facial feminisation standards',
    },
    mandible: {
        name: 'Mandible',
        what: 'Mandible depth in females should be moderate \u2014 not too deep (masculine) but not too recessed (weak). A slightly less prominent mandible is normal and attractive.',
        ideal: '65\u201382% of bizygomatic',
        source: 'Orthognathic norms + facial feminisation',
    },
    temples: {
        name: 'Temples',
        what: 'Full temples frame the face and are associated with youth. Temple hollowing is a key aging marker. Hairstyle can camouflage this better in females than males.',
        ideal: 'Full temporal projection (ratio > 0.9)',
        source: 'Aesthetic medicine norms',
    },
    eyebrows: {
        name: 'Eyebrows',
        what: 'For females, a HIGH ARCHED brow is attractive \u2014 the opposite of the male ideal (low/hooded). A well-defined arch, higher set brow, and medium-to-thin thickness reads as feminine and groomed.',
        ideal: 'High arched, tilt ~10\u201314\u00b0, medium thickness',
        source: 'looksmax.org female brow appeal + aesthetic standards',
    },
    EMEangle: {
        name: 'EME Angle (Eye\u2013Mouth\u2013Eye)',
        what: 'Females have more tolerance for wider EME angles (longer face). Ideal 48\u201352\u00b0. A very compact face can look child-like; slightly wider reads as elegant.',
        ideal: '48\u201352\u00b0',
        source: 'looksmax.org female appeal',
    },
    facialIndex: {
        name: 'Facial Index',
        what: 'For females, a slightly longer face (oval/heart shape) is more attractive. Ideal 1.38\u20131.50. Round/wide faces (index < 1.20) read as juvenile. Very long (>1.60) = horse-face.',
        ideal: '1.35\u20131.52 (oval)',
        source: 'Farkas 1994 + female beauty standards',
    },
    neoclassical: {
        name: 'Neoclassical Canons',
        what: 'The 1/5 eye rule and equal intercanthal/eye-width ratio apply to females too. Slightly wider eyes relative to face (ratio > 1.0) can be attractive due to neoteny \u2014 big eyes = youthful = attractive.',
        ideal: 'Eye ratio 1.0\u20131.1, IC ratio 0.9\u20131.1',
        source: 'Neoclassical canons + PMC10335162',
    },
};

const FEMALE_FIXES = {
    symmetry: `ROOT CAUSES: skeletal asymmetry, uneven sleep, chewing habits, facial trauma.\n\nSOFTMAX:\n\u2022 Sleep on your back \u2014 most impactful free fix\n\u2022 Chew evenly on both sides\n\u2022 Mewing consistently\n\u2022 Contouring makeup to visually balance\n\nHARDMAX:\n\u2022 Masseter Botox (dominant side) \u2014 reduces asymmetric bulk\n\u2022 Rhinoplasty if nasal deviation drives asymmetry\n\u2022 Orthognathic surgery for skeletal cases\n\u2022 Filler to balance asymmetric volume`,
    goldenRatio: `WHICH THIRD IS OFF?\n\u2022 Large lower third \u2192 chin reduction, orthodontics\n\u2022 Small lower third \u2192 chin filler or subtle genioplasty\n\u2022 Large upper third \u2192 brow lift, hairline framing with style\n\u2022 Large middle third \u2192 rhinoplasty tip rotation, maxillary impaction\n\u2022 Small middle third \u2192 maxillary advancement`,
    FWHR: `FWHR TOO HIGH (>1.85) = masculine-looking for a female.\n\nSOFTMAX:\n\u2022 Hairstyles with volume at crown to elongate perceived face shape\n\u2022 Avoid blunt bangs which widen the face\n\u2022 Contouring to slim\n\nHARDMAX:\n\u2022 Buccal fat removal \u2014 slims lower/mid face significantly\n\u2022 Masseter Botox \u2014 reduces jaw width over months\n\u2022 Jaw shave (mandibuloplasty) for skeletal cases\n\nFWHR TOO LOW (<1.45) = very narrow/gaunt face:\n\u2022 Cheek filler to add width\n\u2022 Zygomatic implants`,
    midfaceRatio: `MIDFACE TOO LONG (ratio < 0.90) = elongated midface.\n\nFixes:\n\u2022 Rhinoplasty \u2014 tip rotation shortens visual nasal height\n\u2022 Maxillary impaction (surgical) for severe cases\n\nMIDFACE TOO SHORT (ratio > 1.10):\n\u2022 Rhinoplasty to add nasal length\n\u2022 Lip lift can help proportions`,
    eyeArea: `EYES NOT OPTIMAL FOR FEMALE ATTRACTIVENESS.\n\nFor larger, more neotenous eyes:\n\u2022 Mascara and lash extensions \u2014 immediately opens eyes\n\u2022 Eyeliner: avoid heavy lower liner, use on upper lid only\n\u2022 Brow bone reduction \u2014 creates more eye exposure\n\nFor canthal tilt:\n\u2022 Fox eye makeup technique (temporary)\n\u2022 Canthoplasty / canthopexy \u2014 lifts outer corner\n\nFor eye spacing (ESR):\n\u2022 Eye makeup width techniques\n\u2022 Canthal surgery to reposition`,
    zygomatic: `CHEEKBONES UNDERDEVELOPED.\n\nSOFTMAX:\n\u2022 Body fat at healthy level (not too low \u2014 gaunt looks aged)\n\u2022 Contouring makeup \u2014 most effective short-term fix\n\nHARDMAX:\n\u2022 Cheek filler (HA) \u2014 12\u201318 months, excellent for females\n\u2022 Zygomatic implants \u2014 permanent, highest impact\n\u2022 Fat grafting \u2014 natural, long-lasting`,
    jawline: `FEMALE JAW NOT IDEAL.\n\nToo angular/masculine:\n\u2022 Masseter Botox \u2014 reduces width and softens angles\n\u2022 Jaw shave / mandibuloplasty \u2014 surgical reduction\n\u2022 V-line surgery (popular in Asian aesthetic medicine)\n\nToo receded/weak:\n\u2022 Chin filler \u2014 subtle projection, defines shape\n\u2022 Genioplasty \u2014 precise repositioning`,
    bizygoBigonial: `FACE SHAPE NOT IDEAL.\n\nRatio too low (jaw too wide vs cheekbones = boxy/masculine):\n\u2022 Masseter Botox \u2014 narrows lower face\n\u2022 Jaw shave if skeletal\n\u2022 Cheek filler to increase bizygomatic visual width\n\nBoth too narrow:\n\u2022 Cheek filler + chin filler combo\n\u2022 Zygomatic implants`,
    nose: `NOSE PROPORTIONS FOR FEMALE ATTRACTIVENESS.\n\nToo wide:\n\u2022 Contouring makeup \u2014 most Googled makeup technique\n\u2022 Alar base reduction (alarplasty) \u2014 most direct surgical fix\n\u2022 Rhinoplasty \u2014 comprehensive correction\n\nTip issues:\n\u2022 Tip rhinoplasty for drooping or bulbous tip\n\u2022 Nonsurgical rhinoplasty (filler) \u2014 lifts tip, smooths bridge\n\u2022 Upward tip rotation is highly feminine`,
    lips: `LIP VOLUME AND SHAPE.\n\nSOFTMAX:\n\u2022 Lip liner to define cupid's bow and add perceived volume\n\u2022 Lip plumping gloss\n\u2022 Overlining upper lip (subtly)\n\nHARDMAX:\n\u2022 HA lip filler \u2014 most common cosmetic procedure, very effective\n\u2022 Focus on upper lip volume (1mL upper, 0.5mL lower is a common ratio)\n\u2022 Lip lift \u2014 shortens philtrum, increases upper lip show dramatically\n\u2022 Corner lip lift for downturned corners`,
    maxilla: `MAXILLA / MIDFACE RECESSION.\n\nSOFTMAX:\n\u2022 Mewing \u2014 tongue posture on roof of mouth\n\u2022 Nose breathe only\n\nHARDMAX:\n\u2022 Cheek filler in zygomatic/midface region \u2014 most popular female filler placement\n\u2022 Under-eye (tear trough) filler \u2014 corrects midface recession appearance\n\u2022 LeFort I advancement for structural cases`,
    gonion: `JAW ANGLES.\n\nFor females, gonion SOFTENING is usually the goal:\n\u2022 Masseter Botox \u2014 softens angular jaw corners over 3\u20136 months\n\u2022 Jaw angle reduction surgery if structurally angular\n\nIf too undefined:\n\u2022 Very subtle jaw angle filler\n\u2022 Contouring`,
    mandible: `MANDIBLE ISSUES.\n\nToo prominent/deep (masculine):\n\u2022 Masseter Botox\n\u2022 V-line jaw surgery\n\nToo recessed:\n\u2022 Chin filler\n\u2022 Genioplasty`,
    temples: `HOLLOW TEMPLES \u2014 major aging sign.\n\nSOFTMAX:\n\u2022 Hairstyle to frame (side-swept, waves add fullness)\n\u2022 Maintain healthy body fat \u2014 don't over-diet\n\nHARDMAX:\n\u2022 Temple filler (HA or Sculptra) \u2014 very effective, subtle\n\u2022 Fat grafting \u2014 most natural, longer lasting`,
    eyebrows: `BROWS NOT IDEAL FOR FEMALE ATTRACTIVENESS.\n\nFor higher arch:\n\u2022 Threading / waxing to create clean arch\n\u2022 Fill in and lift the tail with pencil\n\u2022 Lamination for fullness\n\u2022 Microblading / powder brows \u2014 semi-permanent perfect arch\n\nFor over-thick masculine brows:\n\u2022 Professional shaping to thin and arch\n\u2022 Avoid filling in the bottom edge (masculinises)`,
    EMEangle: `EME ANGLE SUBOPTIMAL.\n\nToo wide (>55\u00b0) = very long face or wide-set eyes:\n\u2022 Facial index correction (hair, chin filler)\n\u2022 Eye makeup to make eyes appear closer\n\nToo narrow (<46\u00b0) = very compact/round face:\n\u2022 Vertical hairstyle to elongate\n\u2022 Chin filler for subtle lengthening`,
    facialIndex: `FACIAL INDEX NOT IDEAL FOR FEMALE BEAUTY.\n\nToo low (<1.20, round/wide face):\n\u2022 Hairstyle: add volume at crown, avoid width at sides\n\u2022 Chin filler \u2014 elongates lower face\n\u2022 Buccal fat removal \u2014 slims mid-face\n\nToo high (>1.60, very long/narrow face):\n\u2022 Cheekbone filler / implants to add width\n\u2022 Hairstyle: side volume, waves, avoid straight centre parts`,
    neoclassical: `NEOCLASSICAL CANONS.\n\nEye too small relative to face:\n\u2022 Eye makeup techniques (liner, mascara, lash extensions)\n\u2022 Canthal lengthening surgery\n\u2022 Brow bone reduction for more eye exposure\n\nEyes too far apart (IC ratio > 1.2):\n\u2022 Inner corner eyeliner to reduce perceived spacing\n\nEyes too close (IC ratio < 0.85):\n\u2022 Lighter inner corner highlight\n\u2022 Lateral canthoplasty`,
};

/* ═══════════════════════════════════════════════════════════════════════════
   PATCH
═══════════════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const analyzer = window._analyzerInstance;
        if (!analyzer) { console.warn('[gender.js] analyzer not found'); return; }
        patchAnalyzer(analyzer);
    }, 0);
});

function patchAnalyzer(analyzer) {
    analyzer._selectedGender = null;

    /* ── 1. Intercept analyze() — show gender popup first ── */
    const _origAnalyze = analyzer.analyze.bind(analyzer);
    analyzer.analyze = async function () {
        // Show gender selection popup, wait for user to pick
        await new Promise(resolve => {
            _showGenderSelectPopup(gender => {
                this._selectedGender = gender;
                resolve();
            });
        });
        await _origAnalyze.call(this);
    };

    /* ── 2. Patch calculateScores — female ideals if female selected ── */
    const _origCalcScores = analyzer.calculateScores.bind(analyzer);
    analyzer.calculateScores = function (m) {
        if (this._selectedGender !== 'female') return _origCalcScores(m);
        return _femaleScores(m, GENDER_IDEALS.female, _origCalcScores);
    };

    /* ── 3. Hook into displayResults via app.js _onDisplayResults ── */
    analyzer._onDisplayResults = function (scores, m) {
        const gender = this._selectedGender;
        if (!gender) return;
        if (gender === 'female') {
            _patchFemaleDisplayContent(this.els.featuresBox, scores, m);
            _patchFemaleRatingLabel(scores.overall, this.els.featuresBox);
            _patchFemalePSLScale(this.els.featuresBox);
        }
        _insertGenderBadge(this.els.featuresBox, gender);
    };
}

/* ─── GENDER SELECTION POPUP ─────────────────────────────────────────────── */
function _showGenderSelectPopup(onSelect) {
    const existing = document.getElementById('_genderSelectOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = '_genderSelectOverlay';
    overlay.style.cssText = `
        position:fixed;inset:0;
        background:rgba(0,0,0,0.8);
        z-index:3000;
        display:flex;align-items:center;justify-content:center;
    `;

    overlay.innerHTML = `
        <style>
            @keyframes _gsBoxIn{from{opacity:0;transform:scale(0.93) translateY(16px)}to{opacity:1;transform:scale(1) translateY(0)}}
            #_gsMale:hover,#_gsFemale:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,0.5)!important;}
        </style>
        <div style="
            background:#141414;
            border:1px solid rgba(255,255,255,0.12);
            border-radius:24px;
            padding:40px 32px;
            max-width:360px;
            width:calc(100% - 40px);
            text-align:center;
            box-shadow:0 24px 64px rgba(0,0,0,0.9);
            animation:_gsBoxIn 0.25s ease;
        ">
            <div style="font-size:36px;margin-bottom:16px;line-height:1;">⚥</div>
            <div style="font-size:22px;font-weight:600;color:#fff;margin-bottom:8px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">Select Your Gender</div>
            <div style="font-size:14px;color:rgba(255,255,255,0.45);margin-bottom:32px;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
                Ensures you're scored against the correct attractiveness ideals
            </div>
            <div style="display:flex;flex-direction:column;gap:12px;">
                <button id="_gsMale" style="
                    background:#5ac8fa18;border:2px solid #5ac8fa60;border-radius:14px;
                    padding:18px 24px;color:#fff;font-size:15px;font-weight:600;
                    cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,sans-serif;
                    display:flex;align-items:center;gap:14px;
                    transition:transform 0.15s,box-shadow 0.15s;
                    touch-action:manipulation;
                ">
                    <span style="font-size:30px;line-height:1;">&#9794;</span>
                    <div style="text-align:left;">
                        <div style="color:#5ac8fa;font-size:16px;font-weight:700;">Male</div>
                        <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:3px;">Chad / HTN / PSL scale</div>
                    </div>
                </button>
                <button id="_gsFemale" style="
                    background:#ff6eb418;border:2px solid #ff6eb460;border-radius:14px;
                    padding:18px 24px;color:#fff;font-size:15px;font-weight:600;
                    cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,sans-serif;
                    display:flex;align-items:center;gap:14px;
                    transition:transform 0.15s,box-shadow 0.15s;
                    touch-action:manipulation;
                ">
                    <span style="font-size:30px;line-height:1;">&#9792;</span>
                    <div style="text-align:left;">
                        <div style="color:#ff6eb4;font-size:16px;font-weight:700;">Female</div>
                        <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:3px;">Stacy / HB / Becky scale</div>
                    </div>
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const select = gender => {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.15s';
        setTimeout(() => { overlay.remove(); onSelect(gender); }, 150);
    };

    overlay.querySelector('#_gsMale').addEventListener('click',   () => select('male'));
    overlay.querySelector('#_gsFemale').addEventListener('click', () => select('female'));
    overlay.querySelector('#_gsMale').addEventListener('touchend',   e => { e.preventDefault(); select('male'); });
    overlay.querySelector('#_gsFemale').addEventListener('touchend', e => { e.preventDefault(); select('female'); });
}

/* ─── FEMALE SCORE COMPUTATION ──────────────────────────────────────────── */
function _femaleScores(m, ideals, fallbackFn) {
    const s = fallbackFn(m);

    const gauss = (v, ideal, sigma, floor, peak) =>
        floor + Math.exp(-0.5 * ((v - ideal) / sigma) ** 2) * (peak - floor);
    const lmap = (v, inL, inH, outL, outH) => {
        const t = (v - inL) / (inH - inL);
        const lo = Math.min(outL, outH), hi = Math.max(outL, outH);
        return Math.min(hi, Math.max(lo, outL + t * (outH - outL)));
    };
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const wmean = pairs => { let t=0,w=0; for(const[v,wt]of pairs){t+=clamp(v,0,10)*wt;w+=wt;} return t/w; };

    // Re-score gender-sensitive metrics
    // Facial thirds: females get much wider tolerance — slightly unequal thirds
    // are completely normal and a slightly shorter lower third reads as neotenous
    s.goldenRatio  = lmap(m.facialThirdsDev, 0, 0.35, 10, 2);
    s.FWHR         = gauss(m.FWHR,               ideals.FWHR.ideal,          ideals.FWHR.sigma,          2, 10);
    s.facialIndex  = gauss(m.facialIndex,         ideals.facialIndex.ideal,   ideals.facialIndex.sigma,   3, 10);
    s.midfaceRatio = gauss(m.midfaceRatio,        ideals.midfaceRatio.ideal,  ideals.midfaceRatio.sigma,  2, 10);
    s.EMEangle     = gauss(m.EMEangle,            ideals.EMEangle.ideal,      ideals.EMEangle.sigma,      2, 10);
    s.bizygoBigonial = gauss(m.bizygoBigonialRatio, ideals.bizygoBigonial.ideal, ideals.bizygoBigonial.sigma, 2, 10);
    s.chinPhiltrum   = gauss(m.chinPhiltrumRatio,   ideals.chinPhiltrum.ideal,   ideals.chinPhiltrum.sigma,   2, 10);

    // Eye area — EAR weighted higher (big open eyes = neoteny)
    const ctScore       = gauss(m.avgCanthal, ideals.canthal.ideal, ideals.canthal.sigma, 2, 10);
    const ctAsymPenalty = clamp(m.canthalAsym / 3, 0, 2);
    const esrScore      = gauss(m.ESR, ideals.ESR.ideal, ideals.ESR.sigma, 2, 10);
    const eyeWidthSym   = lmap(m.eyeWidthAsym, 0, 0.15, 10, 2);
    const earScore      = gauss(m.eyeAspectRatio, ideals.EAR.ideal, ideals.EAR.sigma, 3, 10);
    s.eyeArea = clamp(wmean([
        [clamp(ctScore - ctAsymPenalty, 0, 10), 0.30],
        [esrScore,    0.25],
        [eyeWidthSym, 0.15],
        [earScore,    0.30],
    ]) * 1.2, 2, 10);

    // Jawline — softer gonial ideal
    const gonialScore   = gauss(m.jawAngle, ideals.gonialAngle.ideal, ideals.gonialAngle.sigma, 2, 10);
    const jawWidthScore = lmap(m.jawRatio, 0.50, 0.75, 2, 10);
    const hbScore       = gauss(m.heightBigonialRatio, ideals.heightBigonial.ideal, ideals.heightBigonial.sigma, 2, 10);
    const jawFrontal    = gauss(m.jawFrontalAngle, 85, 9, 2, 10);
    s.jawline = wmean([[gonialScore,0.30],[jawWidthScore,0.35],[hbScore,0.20],[jawFrontal,0.15]]);

    // Eyebrows — high arch is better (browLowMap reversed)
    const [bL_inL, bL_inH, bL_outL, bL_outH] = ideals.browLowMap;
    const browLowScore   = lmap(m.browLowsetness, bL_inL, bL_inH, bL_outL, bL_outH);
    const browTiltScore  = gauss(m.avgBrowTilt, ideals.browTilt.ideal, ideals.browTilt.sigma, 4, 10);
    const browThickScore = gauss(m.browThickness, 0.55, 0.25, 4, 10);
    s.eyebrows = clamp(wmean([[browLowScore,0.50],[browTiltScore,0.30],[browThickScore,0.20]]), 2, 10);

    // Nose — narrower ideal
    const nasalScore  = gauss(m.nasalHWratio,     ideals.nasalHW.ideal,   ideals.nasalHW.sigma,  3, 10);
    const alarIcScore = gauss(m.alarIntercanthal, 0.85,                   0.14,                  3, 10);
    const mnScore     = gauss(m.mouthNoseRatio,   ideals.mouthNose.ideal, ideals.mouthNose.sigma, 3, 10);
    const tipScore    = lmap(m.noseTipDeviation,  0.04, 0, 3, 10);
    const alarSym     = lmap(m.alarSymmetry,      0.75, 1.0, 3, 10);
    s.nose = clamp(wmean([[nasalScore,0.35],[alarIcScore,0.20],[mnScore,0.20],[tipScore,0.15],[alarSym,0.10]]), 2, 10);

    // Lips — fuller upper lip matters more
    const lulScore    = gauss(m.lowerUpperLipRatio, ideals.lowerUpperLip.ideal, ideals.lowerUpperLip.sigma, 2, 10);
    const mwFaceScore = gauss(m.mouthWidthFace,     0.48, 0.06, 3, 10);
    s.lips = wmean([[lulScore,0.60],[mwFaceScore,0.40]]);

    // Maxilla
    const mlScore = gauss(m.midfaceLengthRatio, ideals.midfaceLen.ideal, ideals.midfaceLen.sigma, 3, 10);
    const alScore = gauss(m.alarIntercanthal,   0.85, 0.14, 3, 10);
    const mrScore = gauss(m.midfaceRatio,       ideals.midfaceRatio.ideal, ideals.midfaceRatio.sigma, 3, 10);
    s.maxilla = wmean([[mlScore,0.40],[alScore,0.30],[mrScore,0.30]]);

    // Composites — female weights
    s.HARM = wmean([
        [s.symmetry,       0.28],
        [s.goldenRatio,    0.18],
        [s.FWHR,           0.18],
        [s.midfaceRatio,   0.18],
        [s.bizygoBigonial, 0.18],
    ]);

    // ANGU: cheekbones dominate, jaw less critical
    s.ANGU = wmean([
        [s.zygomatic, 0.40],
        [s.jawline,   0.25],
        [s.gonion,    0.20],
        [s.mandible,  0.15],
    ]);

    // NEOT replaces DIMO: eye size, lips, face softness, brows
    s.DIMO = wmean([
        [s.eyeArea,    0.35],
        [s.lips,       0.25],
        [s.facialIndex,0.20],
        [s.eyebrows,   0.20],
    ]);

    // MISC: lips weighted higher
    s.MISC = wmean([
        [s.eyeArea,      0.20],
        [s.nose,         0.20],
        [s.lips,         0.20],
        [s.temples,      0.08],
        [s.EMEangle,     0.12],
        [s.neoclassical, 0.12],
        [s.maxilla,      0.08],
    ]);

    const composite = s.HARM*0.32 + s.MISC*0.26 + s.ANGU*0.22 + s.DIMO*0.20;
    const spread    = Math.max(s.HARM,s.ANGU,s.DIMO,s.MISC) - Math.min(s.HARM,s.ANGU,s.DIMO,s.MISC);
    const penalty   = Math.max(0, spread - 2) * 0.1;
    const conf      = clamp(m.detectionConfidence, 0.5, 1);
    s.overall       = clamp((composite - penalty) * (0.88 + 0.12*conf), 0, 10);
    s.looksmaxxRating = _getFemaleRating(s.overall);

    return s;
}

/* ─── PATCH FEMALE DISPLAY CONTENT ──────────────────────────────────────── */
function _patchFemaleDisplayContent(featuresBox, scores, m) {
    const ORDER = ['symmetry','goldenRatio','FWHR','midfaceRatio','eyeArea','zygomatic',
                   'jawline','bizygoBigonial','nose','lips','maxilla','gonion','mandible',
                   'temples','eyebrows','EMEangle','facialIndex','neoclassical'];

    featuresBox.querySelectorAll('.feature-item').forEach((item, idx) => {
        const key  = ORDER[idx]; if (!key) return;
        const meta = FEMALE_META[key];
        const fix  = FEMALE_FIXES[key];
        const v    = Math.min(10, Math.max(0, scores[key] ?? 5));

        if (meta) {
            const nameEl = item.querySelector('.feature-name');
            if (nameEl) nameEl.textContent = meta.name;
            // Target the description div specifically by its color style
            const descDivs = item.querySelectorAll('div[style*="font-size:11px"][style*="color:rgba(255,255,255,0.35)"]');
            if (descDivs[0]) descDivs[0].textContent = meta.what;
            // Target the ideal line by finding the one that contains "Ideal:"
            const allSmall = item.querySelectorAll('div[style*="font-size:10px"]');
            const idealDiv = Array.from(allSmall).find(d => d.textContent.includes('Ideal:'));
            if (idealDiv) idealDiv.innerHTML = `Ideal: <span style="color:rgba(255,255,255,0.30)">${meta.ideal}</span> &nbsp;\u00b7&nbsp; ${meta.source}`;
        }

        if (fix && v < 5.5) {
            let fixBox = item.querySelector('[style*="border-left:2px solid #ff9f0a"]');
            if (fixBox) { fixBox.textContent = fix; }
            else {
                const newFix = document.createElement('div');
                newFix.style.cssText = 'font-size:11px;color:#ff9f0a;margin-top:8px;padding:9px 11px;background:rgba(255,159,10,0.06);border-left:2px solid #ff9f0a;border-radius:4px;white-space:pre-line;line-height:1.65;';
                newFix.textContent = fix;
                item.appendChild(newFix);
            }
        }
    });

    // Rename DIMO → NEOT
    featuresBox.querySelectorAll('[style*="font-weight:700"]').forEach(el => {
        if (el.textContent.includes('DIMO')) el.textContent = el.textContent.replace('DIMO \u2014 Dimorphism', 'NEOT \u2014 Neoteny');
    });
    featuresBox.querySelectorAll('[style*="font-size:10px"][style*="color:rgba(255,255,255,0.25)"]').forEach(el => {
        if (el.textContent.includes('masculinity markers')) el.textContent = '20% \u2014 neoteny & youthfulness';
    });
}

/* ─── PATCH FEMALE RATING LABEL ─────────────────────────────────────────── */
function _patchFemaleRatingLabel(score, featuresBox) {
    const rating = _getFemaleRating(score);
    const badge  = featuresBox.querySelector('[style*="font-size:26px"]');
    if (badge) {
        badge.textContent = rating.label;
        badge.style.color = rating.color;
        const p = badge.parentElement;
        if (p) { p.style.background = `${rating.color}18`; p.style.borderColor = rating.color; }
    }
    const tooltipEl = featuresBox.querySelector('[style*="color:rgba(255,255,255,0.45)"]');
    if (tooltipEl) tooltipEl.textContent = rating.tooltip;
    featuresBox.querySelectorAll('[style*="font-weight:600"]').forEach(el => {
        if (/^(Top|Bottom)\s[\d.]+%$/.test(el.textContent.trim())) {
            el.textContent = rating.pct;
            el.style.color = rating.color;
        }
    });
}

/* ─── PATCH FEMALE PSL SCALE ─────────────────────────────────────────────── */
function _patchFemalePSLScale(featuresBox) {
    const allDivs = Array.from(featuresBox.querySelectorAll('div'));
    const pslHeader = allDivs.find(d => d.textContent.trim() === 'PSL Scale Reference');
    if (!pslHeader) return;
    const pslSection = pslHeader.parentElement;
    if (!pslSection) return;
    const gridDiv = pslSection.querySelector('[style*="grid-template-columns:1fr 1fr"]');
    if (!gridDiv) return;

    gridDiv.innerHTML = FEMALE_RATING_SCALE.map(([,l,, c, pp]) => {
        // determine range string
        const idx = FEMALE_RATING_SCALE.findIndex(r => r[1] === l);
        const nextThreshold = idx > 0 ? FEMALE_RATING_SCALE[idx-1][0] : 10;
        const thisThreshold = FEMALE_RATING_SCALE[idx][0];
        const range = thisThreshold === 0 ? '<' + FEMALE_RATING_SCALE[idx+1]?.[0] : `${thisThreshold}\u2013${nextThreshold}`;
        return `<div style="display:flex;align-items:center;gap:5px;">
            <span style="color:${c};font-weight:700;min-width:72px;">${l}</span>
            <span style="color:rgba(255,255,255,0.28)">${range}</span>
            <span style="color:rgba(255,255,255,0.15);font-size:9px;margin-left:auto">${pp}</span>
        </div>`;
    }).join('');
}

/* ─── INSERT GENDER BADGE ────────────────────────────────────────────────── */
function _insertGenderBadge(featuresBox, gender) {
    if (featuresBox.querySelector('[data-gender-badge]')) return;
    const firstChild = featuresBox.firstElementChild;
    if (!firstChild) return;

    const color = gender === 'female' ? '#ff6eb4' : '#5ac8fa';
    const label = gender === 'female' ? '\u2640 Female' : '\u2642 Male';
    const scale = gender === 'female' ? 'HB / Stacy Scale' : 'PSL Scale';

    const badge = document.createElement('div');
    badge.setAttribute('data-gender-badge', '1');
    badge.style.cssText = `
        display:inline-flex;align-items:center;gap:8px;
        margin-top:10px;padding:6px 14px;
        background:${color}18;border:1px solid ${color}60;
        border-radius:20px;font-size:12px;
    `;
    badge.innerHTML = `
        <span style="color:${color};font-weight:700;">${label}</span>
        <span style="color:rgba(255,255,255,0.35);font-size:11px;">${scale}</span>
    `;
    const headerInner = firstChild.querySelector('[style*="text-align:center"]') || firstChild;
    headerInner.appendChild(badge);
}

/* ─── HELPERS ────────────────────────────────────────────────────────────── */
function _getFemaleRating(score) {
    for (const [t, label, tooltip, color, pct] of FEMALE_RATING_SCALE) {
        if (score >= t) return { label, tooltip, color, pct };
    }
    return { label:'Low', tooltip:'Severe disharmony', color:'#8b0000', pct:'Bottom 2%' };
}

window.GENDER_IDEALS = GENDER_IDEALS;