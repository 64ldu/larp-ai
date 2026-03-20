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
 * - Loads the ageGenderNet model alongside existing models
 * - Detects gender and estimated age for every photo
 * - For females: swaps in neoteny-based ideals, female-specific descriptions,
 *   female-specific improvement advice, and the HB/Stacy rating scale
 * - For males: keeps all existing app.js behaviour unchanged
 * - Shows detected gender + age + confidence badge in results
 *
 * FEMALE SCORING PHILOSOPHY (looksmax.org female appeal threads):
 * - Neoteny is the primary driver: large eyes, full lips, softer jaw, youthful features
 * - Hunter eyes / canthal tilt still valued but less critically than in males
 * - Low FWHR is GOOD for females (narrower, more feminine face)
 * - Soft gonial angle preferred (no sharp masculine jaw corners)
 * - Wider eye spacing (ESR) is more attractive in females
 * - Fuller lips (especially upper lip volume) is a major attractor
 * - Narrow refined nose scores very high
 * - High brow arch is feminine and attractive
 * - Zygomatic prominence still valued (high cheekbones universal)
 * - DIMO (dimorphism) composite is REPLACED with NEOT (neoteny) for females
 */

/* ─── GENDER-SPECIFIC IDEAL VALUES ──────────────────────────────────────── */
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
        // Canthal tilt: females look good with slight positive tilt but not as critical as males
        // Doe-eye / almond shape is ideal. Negative tilt is more penalised in females.
        canthal:        { ideal: 4,    sigma: 5.0  },
        // ESR: females benefit from slightly wider eye spacing — more neotenous
        ESR:            { ideal: 0.48, sigma: 0.032 },
        // FWHR: females ideal 1.55–1.75 — narrower face = more feminine and attractive
        // High FWHR is actually LESS attractive in females (looks masculine)
        FWHR:           { ideal: 1.65, sigma: 0.14 },
        // Gonial angle: females look better with softer, more obtuse jaw (115–135° ok)
        gonialAngle:    { ideal: 130,  sigma: 9.0  },
        // Facial index: females look best with slightly longer face (oval/heart shapes)
        facialIndex:    { ideal: 1.42, sigma: 0.22 },
        // Chin/philtrum: females benefit from shorter more pointed chin, less vertical height
        chinPhiltrum:   { ideal: 1.9,  sigma: 0.28 },
        // Brow: females benefit from higher arched brow — NOT low-set like males
        // Lower browLowsetness value = more hooded = LESS feminine
        browLowMap:     [0.65, 1.30, 3, 10],  // reversed: higher set = better for females
        // Brow tilt: females benefit from a more arched upward-curving brow
        browTilt:       { ideal: 12,   sigma: 6.0  },
        // Nasal W/H: females strongly prefer narrow refined nose
        nasalHW:        { ideal: 0.58, sigma: 0.14 },
        // Bizygo/bigonial: females benefit from more tapered jaw vs cheekbones
        bizygoBigonial: { ideal: 1.45, sigma: 0.14 },
        // Lower/upper lip: females benefit from fuller upper lip (less ratio, more equal)
        lowerUpperLip:  { ideal: 1.40, sigma: 0.22 },
        // Height/bigonial ratio
        heightBigonial: { ideal: 1.65, sigma: 0.13 },
        // EAR: females score higher with larger, rounder, more open eyes (neoteny)
        EAR:            { ideal: 2.85, sigma: 0.38 },
        // Midface ratio: same ideal, females slightly more tolerance for longer midface
        midfaceRatio:   { ideal: 1.0,  sigma: 0.12 },
        // EME angle: females ok with slightly wider angle (less compact = still feminine)
        EMEangle:       { ideal: 50,   sigma: 3.5  },
        // Mouth/nose: females benefit from slightly wider mouth relative to nose
        mouthNose:      { ideal: 1.65, sigma: 0.22 },
        // Midface length: females slightly shorter ideal midface proportion
        midfaceLen:     { ideal: 0.33, sigma: 0.05 },
    },
};

/* ─── FEMALE PSL / HB SCALE ─────────────────────────────────────────────── */
const FEMALE_RATING_SCALE = [
    [9.8, 'Goddess',     'Perfect genetics — top 0.0001%, runway / elite model tier',                     '#00ffff', 'Top 0.0001%'],
    [9.5, 'Supermodel',  'Genetic elite — Victoria\'s Secret / high fashion tier',                        '#00d4ff', 'Top 0.001%'],
    [9.0, 'Stacy+',      'Exceptional — turns heads universally, top 0.01% of women',                    '#0af5a0', 'Top 0.01%'],
    [8.5, 'Stacy',       'Very high tier — clearly model-level, sought after by high-value men',          '#30d158', 'Top 0.1%'],
    [8.0, 'HB8',         'High tier — very attractive, significant halo effect',                          '#30d158', 'Top 0.5%'],
    [7.5, 'HB7.5',       'Above average — noticeably attractive, gets consistent attention',               '#34c759', 'Top 2%'],
    [7.0, 'HB7',         'Above average — pretty, positive first impressions',                            '#7ee787', 'Top 5%'],
    [6.5, 'HB6.5',       'Slightly above average — good features, minor weaknesses',                      '#ff9f0a', 'Top 15%'],
    [6.0, 'Becky',       'Average — no major strengths or weaknesses',                                    '#ff9f0a', 'Top 30%'],
    [5.5, 'HB5.5',       'Slightly below average',                                                        '#ff6b35', 'Top 50%'],
    [5.0, 'HB5',         'Below average — some notable weaknesses',                                       '#ff6b35', 'Bottom 40%'],
    [4.5, 'HB4.5',       'Notably below average — multiple weak features',                                '#ff453a', 'Bottom 25%'],
    [4.0, 'HB4',         'Significant facial disharmony',                                                 '#ff453a', 'Bottom 15%'],
    [3.5, 'Sub-4F',      'Major structural deficiencies — significant improvement possible',               '#ff2d55', 'Bottom 5%'],
    [0,   'Low',         'Severe disharmony — significant intervention possible',                         '#8b0000', 'Bottom 2%'],
];

/* ─── BLEND IDEALS ───────────────────────────────────────────────────────── */
function blendIdeals(genderResult) {
    const { gender, genderProbability } = genderResult;
    const maleConf   = gender === 'male' ? genderProbability : 1 - genderProbability;
    const femaleConf = 1 - maleConf;

    if (maleConf >= 0.70)   return { ...GENDER_IDEALS.male,   _gender: 'male',   _conf: maleConf };
    if (femaleConf >= 0.70) return { ...GENDER_IDEALS.female, _gender: 'female', _conf: femaleConf };

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
        heightBigonial: { ideal: blend(m.heightBigonial.ideal, f.heightBigonial.ideal), sigma: blend(m.heightBigonial.sigma, f.heightBigonial.sigma) },
        EAR:            { ideal: blend(m.EAR.ideal, f.EAR.ideal),                       sigma: blend(m.EAR.sigma, f.EAR.sigma) },
        midfaceRatio:   { ideal: blend(m.midfaceRatio.ideal, f.midfaceRatio.ideal),     sigma: blend(m.midfaceRatio.sigma, f.midfaceRatio.sigma) },
        EMEangle:       { ideal: blend(m.EMEangle.ideal, f.EMEangle.ideal),             sigma: blend(m.EMEangle.sigma, f.EMEangle.sigma) },
        mouthNose:      { ideal: blend(m.mouthNose.ideal, f.mouthNose.ideal),           sigma: blend(m.mouthNose.sigma, f.mouthNose.sigma) },
        midfaceLen:     { ideal: blend(m.midfaceLen.ideal, f.midfaceLen.ideal),         sigma: blend(m.midfaceLen.sigma, f.midfaceLen.sigma) },
    };
}

/* ─── FEMALE META DESCRIPTIONS ──────────────────────────────────────────── */
const FEMALE_META = {
    symmetry: {
        name: 'Facial Symmetry',
        what: 'Bilateral match across 25 landmark pairs. Symmetry is equally critical for female attractiveness — asymmetry reads as unhealthy or stressed. Females at the top of the scale (Stacy/HB8+) reliably score above 96%.',
        ideal: '\u226597% bilateral match',
        source: 'Bilateral anthropometric standard',
    },
    goldenRatio: {
        name: 'Facial Thirds',
        what: 'Upper (hairline\u2192nasion), middle (nasion\u2192subnasale), lower (subnasale\u2192chin) should each be 33.3%. For females, a slightly shorter lower third (30\u201332%) can read as youthful and neotenous rather than a flaw.',
        ideal: '<8% deviation from equal thirds',
        source: 'Alfertshofer 2024 + looksmax.org female appeal threads',
    },
    FWHR: {
        name: 'FWHR (Facial Width-to-Height Ratio)',
        what: 'For females, LOWER FWHR is more attractive \u2014 a narrower, more oval face reads as feminine. The ideal female range is 1.55\u20131.75. High FWHR (>1.9) starts to look masculine on a female face. This is the OPPOSITE of the male ideal.',
        ideal: '1.55\u20131.75 (lower = more feminine)',
        source: 'looksmax.org female appeal + sexual dimorphism literature',
    },
    midfaceRatio: {
        name: 'Midface Ratio (IPD/MFH)',
        what: 'IPD divided by midface height. Ideal is 1:1. For females, a slightly longer midface (ratio 0.90\u20130.95) is acceptable and can look elegant. Very short midfaces look babyish; very long reads as horse-face.',
        ideal: '0.92\u20131.05',
        source: 'looksmax.org + PMC10335162',
    },
    eyeArea: {
        name: 'Eye Area',
        what: 'For females, large open eyes are a PRIMARY neoteny marker. Bigger eyes = more attractive in females (unlike males where hunter/narrow eyes score well). Positive canthal tilt still valued but doe-eyes / almond shape also scores high. ESR (wider spacing) is more attractive in females.',
        ideal: 'Large, open, ESR 0.46\u20130.50, slight positive or neutral tilt',
        source: 'looksmax.org female neoteny threads + PSL community',
    },
    zygomatic: {
        name: 'Zygomatic Arch',
        what: 'High cheekbones are universally attractive in females \u2014 one of the strongest halo features. The "model cheekbone" look. Prominent cheekbones create the ogee curve that is the hallmark of female beauty.',
        ideal: '>85% of head width (higher = better)',
        source: 'PMC10335162 + looksmax.org female appeal',
    },
    jawline: {
        name: 'Jawline',
        what: 'Female jawline ideal is SOFT, not angular. A slightly obtuse gonial angle (125\u2013138\u00b0) reads as feminine. Sharp squared jaw angles look masculine on females. A tapered, oval jaw with subtle definition is ideal. The V-shape jaw is highly sought after.',
        ideal: 'Gonial 125\u2013138\u00b0, soft tapered V-shape',
        source: 'looksmax.org female jaw appeal + orthognathic literature',
    },
    bizygoBigonial: {
        name: 'Bizygo/Bigonial Ratio',
        what: 'For females, a HIGHER ratio is better \u2014 cheekbones significantly wider than jaw creates the coveted heart/V-shape face. Ideal ~1.45. This is the shape that defines model faces. A wide jaw narrowing ratio reads as boxy/masculine.',
        ideal: '1.35\u20131.55 (higher = more feminine heart shape)',
        source: 'looksmax.org female face shape + aesthetic surgery standards',
    },
    nose: {
        name: 'Nose',
        what: 'Females strongly benefit from a narrow, refined nose. W/H ratio ideally 0.45\u20130.65. A button nose or thin straight nose is a major attractor in females. Wide noses are penalised more heavily in female scoring. Upturned tip (slight) also reads as cute/neotenous.',
        ideal: 'W/H 0.40\u20130.68, narrow and refined',
        source: 'looksmax.org + rhinoplasty aesthetic standards',
    },
    lips: {
        name: 'Lips',
        what: 'Lips are one of the most important features for female attractiveness. Fuller lips score significantly higher. For females, the ideal lower/upper ratio is closer to 1.4 (more equal volume) rather than the male ideal of 1.62. Upper lip fullness and a defined cupid\'s bow are major attractors.',
        ideal: 'L/U 1.2\u20131.6, full upper lip, defined cupid\'s bow',
        source: 'looksmax.org female lips + Penna et al. 2015',
    },
    maxilla: {
        name: 'Midface / Maxilla',
        what: 'Forward maxilla projection creates the "model midface" \u2014 lifted cheeks, no nasolabial hollow, supported under-eye. Frontal proxies: midface length 31\u201337% of face height. For females, slight forward maxilla also prevents the sunken/flat look.',
        ideal: 'Midface 31\u201337%, alar/IC \u22481.0',
        source: 'Alfertshofer 2024 + aesthetic surgery standards',
    },
    gonion: {
        name: 'Gonion',
        what: 'For females, visible jaw angle definition is less important than in males. A smooth, rounded gonion with subtle definition reads as feminine. Very prominent sharp jaw angles look masculine. The ideal is definition without angularity.',
        ideal: '65\u201380% of bizygomatic (softer than male ideal)',
        source: 'looksmax.org female jaw + facial feminisation standards',
    },
    mandible: {
        name: 'Mandible',
        what: 'Mandible depth in females should be moderate \u2014 not too deep (looks masculine) but not too recessed (looks weak/receding). A slightly less prominent mandible than males is normal and attractive in females.',
        ideal: '65\u201382% of bizygomatic',
        source: 'Orthognathic norms + facial feminisation',
    },
    temples: {
        name: 'Temples',
        what: 'Full temples frame the face and are associated with youth and health in females. Temple hollowing is a key aging marker. Hairstyle can camouflage this better in females than males.',
        ideal: 'Full temporal projection (ratio > 0.9)',
        source: 'Aesthetic medicine norms',
    },
    eyebrows: {
        name: 'Eyebrows',
        what: 'For females, a HIGH ARCHED brow is attractive \u2014 the opposite of the male ideal (low/hooded). A well-defined arch, higher set brow, and medium-to-thin thickness reads as feminine and groomed. Over-thick brows can look masculine. The ideal tilt for females is a clear upward arch peaking at the outer third.',
        ideal: 'High arched, tilt ~10\u201314\u00b0, medium thickness',
        source: 'looksmax.org female brow appeal + aesthetic standards',
    },
    EMEangle: {
        name: 'EME Angle (Eye\u2013Mouth\u2013Eye)',
        what: 'Females have slightly more tolerance for wider EME angles (longer face). The ideal for females is 48\u201352\u00b0. A very compact face (narrow angle) can look child-like; a slightly wider angle reads as elegant.',
        ideal: '48\u201352\u00b0',
        source: 'looksmax.org female appeal',
    },
    facialIndex: {
        name: 'Facial Index',
        what: 'For females, a slightly longer face (oval/heart shape) is more attractive. Ideal 1.38\u20131.50. Round/wide faces (index < 1.20) read as juvenile in a non-neotenous way. Very long faces (>1.60) read as horse-face. The oval face shape is the universal female ideal.',
        ideal: '1.35\u20131.52 (oval)',
        source: 'Farkas 1994 + female beauty standards',
    },
    neoclassical: {
        name: 'Neoclassical Canons',
        what: 'The 1/5 eye rule and equal intercanthal/eye-width ratio apply equally to females. In females, slightly wider eyes relative to face (ratio > 1.0) can be attractive due to neoteny \u2014 big eyes = youthful = attractive.',
        ideal: 'Eye ratio 1.0\u20131.1, IC ratio 0.9\u20131.1',
        source: 'Neoclassical canons + PMC10335162',
    },
};

/* ─── FEMALE FIXES / IMPROVEMENT ADVICE ─────────────────────────────────── */
const FEMALE_FIXES = {
    symmetry: `ROOT CAUSES: skeletal asymmetry, uneven sleep, chewing habits, previous facial trauma.\n\nSOFTMAX:\n\u2022 Sleep on your back \u2014 most impactful free fix\n\u2022 Chew evenly on both sides\n\u2022 Mewing consistently\n\u2022 Contouring makeup to visually balance\n\nHARDMAX:\n\u2022 Masseter Botox (dominant side) \u2014 reduces asymmetric bulk\n\u2022 Rhinoplasty if nasal deviation is the main asymmetry driver\n\u2022 Orthognathic surgery for skeletal cases\n\u2022 Filler to balance asymmetric volume`,

    goldenRatio: `WHICH THIRD IS OFF?\n\u2022 Large lower third \u2192 chin reduction, orthodontics, soft tissue correction\n\u2022 Small lower third \u2192 chin filler or subtle genioplasty\n\u2022 Large upper third \u2192 botox brow lift, hairline framing with style\n\u2022 Large middle third \u2192 rhinoplasty tip rotation, maxillary impaction\n\u2022 Small middle third \u2192 maxillary advancement`,

    FWHR: `FWHR TOO HIGH (>1.85) = masculine-looking face for a female.\n\nSOFTMAX:\n\u2022 Hairstyles that add height (volume at crown) to elongate perceived face shape\n\u2022 Avoid blunt bangs which widen the face\n\u2022 Contouring to slim the face\n\nHARDMAX:\n\u2022 Buccal fat removal \u2014 slims lower/mid face significantly\n\u2022 Masseter Botox \u2014 reduces jaw width over months\n\u2022 Jaw shave (mandibuloplasty) for skeletal cases\n\nFWHR TOO LOW (<1.45) = very narrow/gaunt face:\n\u2022 Cheek filler to add width\n\u2022 Zygomatic implants`,

    midfaceRatio: `MIDFACE TOO LONG (ratio < 0.90) = elongated midface.\n\nFixes:\n\u2022 Rhinoplasty \u2014 tip rotation to shorten visual nasal height\n\u2022 Maxillary impaction (surgical) for severe cases\n\nMIDFACE TOO SHORT (ratio > 1.10):\n\u2022 Rhinoplasty to add nasal length\n\u2022 Lip lift can help proportions`,

    eyeArea: `EYES NOT OPTIMAL FOR FEMALE ATTRACTIVENESS.\n\nFor larger, more neotenous eyes:\n\u2022 Mascara and lash extensions \u2014 immediately opens eyes\n\u2022 Eyeliner: avoid heavy lower liner (shrinks eyes), use on upper lid\n\u2022 Upper eyelid filler / brow bone reduction \u2014 creates more eye exposure\n\nFor canthal tilt:\n\u2022 Fox eye makeup technique (temporary)\n\u2022 Canthoplasty / canthopexy \u2014 lifts outer corner\n\u2022 Lower eyelid retraction repair\n\nFor eye spacing (ESR):\n\u2022 Eye makeup width techniques\n\u2022 Canthal surgery to reposition`,

    zygomatic: `CHEEKBONES UNDERDEVELOPED.\n\nSOFTMAX:\n\u2022 Body fat at healthy level (not too low \u2014 gaunt cheeks look aged)\n\u2022 Contouring makeup \u2014 most effective short-term fix\n\u2022 Smile technique to show zygomatic muscle\n\nHARDMAX:\n\u2022 Cheek filler (HA) \u2014 12\u201318 months, excellent for females\n\u2022 Zygomatic implants \u2014 permanent, highest impact\n\u2022 Fat grafting \u2014 natural, long-lasting`,

    jawline: `FEMALE JAW NOT IDEAL.\n\nToo angular/masculine (common issue):\n\u2022 Masseter Botox \u2014 reduces jaw width and softens angles\n\u2022 Jaw shave / mandibuloplasty \u2014 surgical reduction\n\u2022 V-line surgery (popular in Asian aesthetic medicine)\n\nToo receded/weak:\n\u2022 Chin filler \u2014 subtle projection, defines shape\n\u2022 Genioplasty \u2014 precise surgical repositioning\n\u2022 Jaw implants if structurally deficient`,

    bizygoBigonial: `FACE SHAPE NOT IDEAL.\n\nRatio too low (jaw too wide vs cheekbones = boxy/masculine):\n\u2022 Masseter Botox \u2014 narrows lower face\n\u2022 Jaw shave if skeletal\n\u2022 Cheek filler to increase bizygomatic visual width\n\nRatio too low (narrow jaw AND narrow cheekbones):\n\u2022 Cheek filler + chin filler combo\n\u2022 Zygomatic implants`,

    nose: `NOSE PROPORTIONS FOR FEMALE ATTRACTIVENESS.\n\nToo wide (most common issue):\n\u2022 Contouring makeup \u2014 nose slimming is most Googled makeup technique\n\u2022 Alar base reduction (alarplasty) \u2014 most direct surgical fix\n\u2022 Rhinoplasty \u2014 comprehensive correction\n\nTip issues:\n\u2022 Tip rhinoplasty for drooping or bulbous tip\n\u2022 Nonsurgical rhinoplasty (filler) \u2014 lifts tip, smooths bridge\n\u2022 Upward tip rotation is highly feminine`,

    lips: `LIP VOLUME AND SHAPE.\n\nSOFTMAX:\n\u2022 Lip liner to define cupid's bow and add perceived volume\n\u2022 Lip plumping gloss\n\u2022 Overlining upper lip (when done subtly)\n\nHARDMAX:\n\u2022 HA lip filler \u2014 most common cosmetic procedure, very effective\n\u2022 Focus on upper lip volume (1mL upper, 0.5mL lower is a common female ratio)\n\u2022 Lip lift \u2014 shortens philtrum, dramatically increases upper lip show\n\u2022 Corner lip lift for downturned corners\n\u2022 Russian lips technique for heart-shape definition`,

    maxilla: `MAXILLA / MIDFACE RECESSION.\n\nSOFTMAX:\n\u2022 Mewing \u2014 tongue posture on roof of mouth\n\u2022 Nose breathe only\n\u2022 Good posture reduces forward head that compresses midface\n\nHARDMAX:\n\u2022 Cheek filler in the zygomatic/midface region \u2014 most popular female filler placement\n\u2022 Under-eye (tear trough) filler \u2014 corrects midface recession appearance\n\u2022 LeFort I advancement for structural cases\n\u2022 BiMax for severe recession`,

    gonion: `JAW ANGLES.\n\nFor females, gonion SOFTENING is usually the goal, not enhancement:\n\u2022 Masseter Botox \u2014 softens angular jaw corners over 3\u20136 months\n\u2022 Jaw angle reduction surgery if structurally angular\n\nIf too undefined:\n\u2022 Very subtle jaw angle filler\n\u2022 Contouring`,

    mandible: `MANDIBLE ISSUES.\n\nToo prominent/deep (masculine):\n\u2022 Masseter Botox\n\u2022 V-line jaw surgery\n\nToo recessed:\n\u2022 Chin filler\n\u2022 Genioplasty`,

    temples: `HOLLOW TEMPLES \u2014 major aging sign.\n\nSOFTMAX:\n\u2022 Hairstyle to frame (side-swept, waves add fullness)\n\u2022 Maintain healthy body fat \u2014 don't over-diet\n\nHARDMAX:\n\u2022 Temple filler (HA or Sculptra) \u2014 very effective, subtle\n\u2022 Fat grafting \u2014 most natural, longer lasting`,

    eyebrows: `BROWS NOT IDEAL FOR FEMALE ATTRACTIVENESS.\n\nFor higher arch and better shape:\n\u2022 Threading / waxing to create clean arch\n\u2022 Fill in and lift the tail with pencil\n\u2022 Lamination for fullness\n\u2022 Microblading / powder brows \u2014 semi-permanent perfect arch\n\nFor over-thick masculine brows:\n\u2022 Professional shaping to thin and arch\n\u2022 Avoid filling in the bottom edge (masculinises)\n\nFor high brow position:\n\u2022 Brow bone reduction \u2014 lowers supraorbital rim, creates depth`,

    EMEangle: `EME ANGLE SUBOPTIMAL.\n\nToo wide (>55\u00b0) = very long face or very wide-set eyes:\n\u2022 Facial index correction (hair, chin filler)\n\u2022 Eye makeup to make eyes appear closer\n\nToo narrow (<46\u00b0) = very compact/round face:\n\u2022 Vertical hairstyle to elongate\n\u2022 Chin filler for subtle lengthening`,

    facialIndex: `FACIAL INDEX NOT IDEAL FOR FEMALE BEAUTY.\n\nToo low (<1.20, very round/wide face):\n\u2022 Hairstyle: add volume at crown, avoid width at sides\n\u2022 Chin filler \u2014 elongates lower face\n\u2022 Buccal fat removal \u2014 slims mid-face\n\nToo high (>1.60, very long/narrow face):\n\u2022 Cheekbone filler / implants to add width\n\u2022 Hairstyle: side volume, waves, avoid straight centre parts`,

    neoclassical: `NEOCLASSICAL CANONS.\n\nEye too small relative to face:\n\u2022 Eye makeup techniques (liner, mascara, lash extensions)\n\u2022 Canthal lengthening surgery\n\u2022 Brow bone reduction for more eye exposure\n\nEyes too far apart (IC ratio > 1.2):\n\u2022 Inner corner eyeliner to reduce perceived spacing\n\u2022 Medial canthal surgery (aggressive)\n\nEyes too close (IC ratio < 0.85):\n\u2022 Lighter inner corner highlight\n\u2022 Lateral canthoplasty`,
};

/* ═══════════════════════════════════════════════════════════════════════════
   MONKEY-PATCH
═══════════════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const analyzer = window._analyzerInstance;
        if (!analyzer) {
            console.warn('[gender.js] Could not find window._analyzerInstance');
            return;
        }
        patchAnalyzer(analyzer);
    }, 0);
});

function patchAnalyzer(analyzer) {

    /* ── 1. Load ageGenderNet ── */
    const _origInitModels = analyzer.initModels.bind(analyzer);
    analyzer.initModels = async function () {
        await _origInitModels();
        try {
            console.log('[gender.js] Attempting to load ageGenderNet...');
            await faceapi.nets.ageGenderNet.loadFromUri('./weights');
            this._genderModelLoaded = true;
            console.log('[gender.js] ageGenderNet loaded \u2713');
        } catch (e) {
            console.warn('[gender.js] ageGenderNet not found \u2014 gender detection disabled.\n' +
                'Download from: https://github.com/justadudewhohacks/face-api.js/tree/master/weights');
            console.error('[gender.js] Error loading ageGenderNet:', e);
            this._genderModelLoaded = false;
        }
    };

    /* ── 2. Reset gender state on each analyze ── */
    const _origAnalyze = analyzer.analyze.bind(analyzer);
    analyzer.analyze = async function () {
        this._genderResult = null;
        this._ideals = null;
        await _origAnalyze();
    };

    /* ── 3. Run gender detection alongside face detection ── */
    const _origDetect = analyzer._detect.bind(analyzer);
    analyzer._detect = async function () {
        console.log('[gender.js] _detect called, _genderModelLoaded:', this._genderModelLoaded);
        const det = await _origDetect();
        if (!det || !this._genderModelLoaded) {
            console.log('[gender.js] Skipping gender detection - no detection or model not loaded');
            return det;
        }

        try {
            console.log('[gender.js] Running gender detection...');
            this.setLoader('Detecting gender & age\u2026');
            const withGender = await faceapi
                .detectSingleFace(this.currentImage,
                    this.useTiny
                        ? new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.3 })
                        : new faceapi.SsdMobilenetv1Options({ minConfidenceScore: 0.35 })
                )
                .withFaceLandmarks()
                .withAgeAndGender();

            console.log('[gender.js] Gender detection result:', withGender);
            if (withGender) {
                this._genderResult = {
                    gender:            withGender.gender,
                    genderProbability: withGender.genderProbability,
                    age:               Math.round(withGender.age),
                };
                this._ideals = blendIdeals(this._genderResult);
                console.log(`[gender.js] ${this._genderResult.gender} ` +
                    `(${(this._genderResult.genderProbability * 100).toFixed(0)}% conf), ` +
                    `age ~${this._genderResult.age}`);
            } else {
                console.log('[gender.js] No gender detection result');
            }
        } catch (e) {
            console.warn('[gender.js] Gender detection failed:', e.message);
        }

        return det;
    };

    /* ── 4. Gender-aware scoring ── */
    const _origCalcScores = analyzer.calculateScores.bind(analyzer);
    analyzer.calculateScores = function (m) {
        const ideals = this._ideals;
        if (!ideals) return _origCalcScores(m);
        return _genderAwareScores(m, ideals, _origCalcScores);
    };

    /* ── 5. Intercept displayResults — show gender popup first ── */
    const _origDisplay = analyzer.displayResults.bind(analyzer);
    analyzer.displayResults = function (scores, m) {
        console.log('[gender.js] displayResults called, genderResult:', this._genderResult);
        this._showGenderConfirm(scores, m);
    };

    /* ── 6. Show gender confirmation popup after scoring ── */
    analyzer._showGenderConfirm = function(scores, m) {
        console.log('[gender.js] _showGenderConfirm called');
        const gr = this._genderResult;
        console.log('[gender.js] genderResult:', gr);
        if (!gr) {
            console.log('[gender.js] No gender detected - showing results directly');
            // No gender detected — just show results directly
            _origDisplay(scores, m);
            return;
        }

        const isFemale = gr.gender === 'female';
        const color    = isFemale ? '#ff6eb4' : '#5ac8fa';
        const icon     = isFemale ? '♀' : '♂';
        const label    = isFemale ? 'Female' : 'Male';
        const opposite = isFemale ? 'Male' : 'Female';
        const confPct  = (gr.genderProbability * 100).toFixed(0);

        // Populate popup
        console.log('[gender.js] Populating popup...');
        const overlay    = document.getElementById('genderConfirmOverlay');
        const iconEl     = document.getElementById('genderConfirmIcon');
        const labelEl    = document.getElementById('genderConfirmLabel');
        const confirmBtn = document.getElementById('genderConfirmYes');
        const switchBtn  = document.getElementById('genderConfirmSwitch');

        console.log('[gender.js] Popup elements:', { overlay: !!overlay, iconEl: !!iconEl, labelEl: !!labelEl, confirmBtn: !!confirmBtn, switchBtn: !!switchBtn });

        if (!overlay) {
            console.log('[gender.js] Popup overlay not found - showing results directly');
            // Popup HTML not in index.html — skip straight to results
            _origDisplay(scores, m);
            return;
        }

        iconEl.textContent  = icon;
        iconEl.style.color  = color;
        labelEl.textContent = `${icon} ${label}  ·  ${confPct}% confidence`;
        labelEl.style.background = `${color}18`;
        labelEl.style.border     = `1px solid ${color}60`;
        labelEl.style.color      = color;
        switchBtn.textContent    = `Different Gender — Switch to ${opposite}`;

        console.log('[gender.js] Adding active class to overlay');
        overlay.classList.add('active');
        console.log('[gender.js] Overlay classes:', overlay.className);

        // Confirm button — show results as detected
        const onConfirm = () => {
            overlay.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            switchBtn.removeEventListener('click', onSwitch);
            _origDisplay(scores, m);
            // Patch female display if female
            if (isFemale) {
                _patchFemaleDisplayContent(analyzer.els.featuresBox, scores, m);
                _patchFemaleRatingLabel(scores.overall, analyzer.els.featuresBox);
            }
            // Insert gender badge
            _insertGenderBadge(analyzer.els.featuresBox, gr);
        };

        // Switch button — flip gender and re-score
        const onSwitch = () => {
            overlay.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            switchBtn.removeEventListener('click', onSwitch);

            // Override gender result to opposite
            const flipped = {
                gender:            isFemale ? 'male' : 'female',
                genderProbability: 0.95,
                age:               gr.age,
            };
            analyzer._genderResult = flipped;
            analyzer._ideals       = blendIdeals(flipped);

            // Re-score and re-display with flipped gender
            const newScores = analyzer.calculateScores(analyzer.measurements);
            analyzer.scores = newScores;
            _origDisplay(newScores, analyzer.measurements);

            const newFemale = flipped.gender === 'female';
            if (newFemale) {
                _patchFemaleDisplayContent(analyzer.els.featuresBox, newScores, analyzer.measurements);
                _patchFemaleRatingLabel(newScores.overall, analyzer.els.featuresBox);
            }
            _insertGenderBadge(analyzer.els.featuresBox, flipped);

            // Update score ring
            const C = 389.6;
            analyzer.els.scoreCircle.style.strokeDashoffset = C - (newScores.overall / 10) * C;
            analyzer.els.scoreNum.textContent = newScores.overall.toFixed(1);
        };

        confirmBtn.addEventListener('click', onConfirm);
        switchBtn.addEventListener('click', onSwitch);
    };
}

/* ─── PATCH FEMALE DISPLAY CONTENT ──────────────────────────────────────── */
function _patchFemaleDisplayContent(featuresBox, scores, m) {
    // Replace feature descriptions and fix boxes for female-specific content
    const featureItems = featuresBox.querySelectorAll('.feature-item');

    const ORDER = ['symmetry','goldenRatio','FWHR','midfaceRatio','eyeArea','zygomatic',
                   'jawline','bizygoBigonial','nose','lips','maxilla','gonion','mandible',
                   'temples','eyebrows','EMEangle','facialIndex','neoclassical'];

    featureItems.forEach((item, idx) => {
        const key = ORDER[idx];
        if (!key) return;

        const meta = FEMALE_META[key];
        const fix  = FEMALE_FIXES[key];
        const v    = Math.min(10, Math.max(0, scores[key] ?? 5));

        if (meta) {
            // Replace the "what" description text
            const descDiv = item.querySelectorAll('div[style*="font-size:11px"]')[0];
            if (descDiv && meta.what) descDiv.textContent = meta.what;

            // Replace the ideal line
            const idealDiv = item.querySelectorAll('div[style*="font-size:10px"]')[0];
            if (idealDiv && meta.ideal) {
                idealDiv.innerHTML = `Ideal: <span style="color:rgba(255,255,255,0.30)">${meta.ideal}</span> &nbsp;\u00b7&nbsp; ${meta.source}`;
            }

            // Replace feature name
            const nameEl = item.querySelector('.feature-name');
            if (nameEl && meta.name) nameEl.textContent = meta.name;
        }

        // Replace or add the fix box
        if (fix && v < 5.5) {
            let fixBox = item.querySelector('[style*="border-left:2px solid #ff9f0a"]');
            if (fixBox) {
                fixBox.textContent = fix;
            } else {
                const newFix = document.createElement('div');
                newFix.style.cssText = 'font-size:11px;color:#ff9f0a;margin-top:8px;padding:9px 11px;background:rgba(255,159,10,0.06);border-left:2px solid #ff9f0a;border-radius:4px;white-space:pre-line;line-height:1.65;';
                newFix.textContent = fix;
                item.appendChild(newFix);
            }
        }
    });

    // Replace DIMO label with NEOT in the composite breakdown
    const compositeLabels = featuresBox.querySelectorAll('[style*="font-weight:700"]');
    compositeLabels.forEach(el => {
        if (el.textContent.includes('DIMO')) {
            el.textContent = el.textContent.replace('DIMO \u2014 Dimorphism', 'NEOT \u2014 Neoteny');
        }
    });

    // Replace sub-score description
    const descSpans = featuresBox.querySelectorAll('[style*="font-size:10px"][style*="color:rgba(255,255,255,0.25)"]');
    descSpans.forEach(el => {
        if (el.textContent.includes('masculinity markers')) {
            el.textContent = '20% \u2014 neoteny & youthfulness';
        }
    });
}

/* ─── GENDER-AWARE SCORE COMPUTATION ────────────────────────────────────── */
function _genderAwareScores(m, ideals, fallbackFn) {
    const s = fallbackFn(m);

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

    const isFemale = ideals._gender === 'female';

    // ── Gender-adaptive individual scores ──
    s.FWHR        = gauss(m.FWHR,        ideals.FWHR.ideal,        ideals.FWHR.sigma,        2, 10);
    s.facialIndex = gauss(m.facialIndex, ideals.facialIndex.ideal, ideals.facialIndex.sigma, 3, 10);
    s.midfaceRatio = gauss(m.midfaceRatio, ideals.midfaceRatio.ideal, ideals.midfaceRatio.sigma, 2, 10);
    s.EMEangle    = gauss(m.EMEangle,    ideals.EMEangle.ideal,    ideals.EMEangle.sigma,    2, 10);
    s.bizygoBigonial = gauss(m.bizygoBigonialRatio, ideals.bizygoBigonial.ideal, ideals.bizygoBigonial.sigma, 2, 10);
    s.chinPhiltrum   = gauss(m.chinPhiltrumRatio,   ideals.chinPhiltrum.ideal,   ideals.chinPhiltrum.sigma,   2, 10);

    // Eye area — for females: larger open eyes score higher (neoteny)
    const ctScore       = gauss(m.avgCanthal, ideals.canthal.ideal, ideals.canthal.sigma, 2, 10);
    const ctAsymPenalty = clamp(m.canthalAsym / 3, 0, 2);
    const esrScore      = gauss(m.ESR, ideals.ESR.ideal, ideals.ESR.sigma, 2, 10);
    const eyeWidthSym   = lmap(m.eyeWidthAsym, 0, 0.15, 10, 2);
    const earScore      = gauss(m.eyeAspectRatio, ideals.EAR.ideal, ideals.EAR.sigma, 3, 10);
    // For females: EAR weight is higher (big eyes = neoteny), canthal tilt weight slightly lower
    const eyeWeights = isFemale
        ? [[clamp(ctScore - ctAsymPenalty, 0, 10), 0.30], [esrScore, 0.25], [eyeWidthSym, 0.15], [earScore, 0.30]]
        : [[clamp(ctScore - ctAsymPenalty, 0, 10), 0.40], [esrScore, 0.25], [eyeWidthSym, 0.15], [earScore, 0.20]];
    s.eyeArea = clamp(wmean(eyeWeights) * 1.2, 2, 10);

    // Jawline — for females: softer gonial angle is rewarded
    const gonialScore   = gauss(m.jawAngle, ideals.gonialAngle.ideal, ideals.gonialAngle.sigma, 2, 10);
    const jawWidthScore = lmap(m.jawRatio, isFemale ? 0.50 : 0.55, isFemale ? 0.75 : 0.82, 2, 10);
    const hbScore       = gauss(m.heightBigonialRatio, ideals.heightBigonial.ideal, ideals.heightBigonial.sigma, 2, 10);
    const jawFrontal    = gauss(m.jawFrontalAngle, isFemale ? 85 : 88, isFemale ? 9 : 7, 2, 10);
    s.jawline = wmean([[gonialScore,0.30],[jawWidthScore,0.35],[hbScore,0.20],[jawFrontal,0.15]]);

    // Eyebrows — for females: high arch is better (reversed vs males)
    const [bLow_inL, bLow_inH, bLow_outL, bLow_outH] = ideals.browLowMap;
    const browLowScore   = lmap(m.browLowsetness, bLow_inL, bLow_inH, bLow_outL, bLow_outH);
    const browTiltScore  = gauss(m.avgBrowTilt, ideals.browTilt.ideal, ideals.browTilt.sigma, 4, 10);
    // For females: thickness less important (thinner arched brows are fine)
    const browThickScore = isFemale
        ? gauss(m.browThickness, 0.55, 0.25, 4, 10)  // medium thickness is ideal for females
        : lmap(m.browThickness, 0.25, 1.0, 3, 10);
    s.eyebrows = clamp(wmean([[browLowScore,0.50],[browTiltScore,0.30],[browThickScore,0.20]]), 2, 10);

    // Nose — females: narrower is significantly better
    const nasalScore  = gauss(m.nasalHWratio,     ideals.nasalHW.ideal,   ideals.nasalHW.sigma,   3, 10);
    const alarIcScore = gauss(m.alarIntercanthal, isFemale ? 0.85 : 1.0,  isFemale ? 0.14 : 0.18, 3, 10);
    const mnScore     = gauss(m.mouthNoseRatio,   ideals.mouthNose.ideal, ideals.mouthNose.sigma,  3, 10);
    const tipScore    = lmap(m.noseTipDeviation,  0.04, 0, 3, 10);
    const alarSym     = lmap(m.alarSymmetry,      0.75, 1.0, 3, 10);
    s.nose = clamp(wmean([[nasalScore,0.35],[alarIcScore,0.20],[mnScore,0.20],[tipScore,0.15],[alarSym,0.10]]), 2, 10);

    // Lips — for females: fuller lips score higher, upper lip fullness matters more
    const lulScore    = gauss(m.lowerUpperLipRatio, ideals.lowerUpperLip.ideal, ideals.lowerUpperLip.sigma, 2, 10);
    const mwFaceScore = gauss(m.mouthWidthFace,     isFemale ? 0.48 : 0.50,    isFemale ? 0.06 : 0.07,    3, 10);
    s.lips = wmean([[lulScore, 0.60],[mwFaceScore, 0.40]]);

    // Maxilla
    const mlScore = gauss(m.midfaceLengthRatio, ideals.midfaceLen.ideal, ideals.midfaceLen.sigma, 3, 10);
    const alScore = gauss(m.alarIntercanthal, isFemale ? 0.85 : 1.0, 0.14, 3, 10);
    const mrScore = gauss(m.midfaceRatio, ideals.midfaceRatio.ideal, ideals.midfaceRatio.sigma, 3, 10);
    s.maxilla = wmean([[mlScore, 0.40],[alScore, 0.30],[mrScore, 0.30]]);

    // ── Composite weights ──
    // For females: DIMO → NEOT (neoteny replaces dimorphism)
    // Neoteny: eye size, lips, face shape softness, youthful features

    s.HARM = wmean([
        [s.symmetry,      0.28],
        [s.goldenRatio,   0.18],
        [s.FWHR,          0.18],
        [s.midfaceRatio,  0.18],
        [s.bizygoBigonial,0.18],
    ]);

    // ANGU for females: less weight on jaw angularity, more on zygomatic/cheekbones
    s.ANGU = wmean(isFemale ? [
        [s.zygomatic,   0.40],   // cheekbones dominate female angularity appeal
        [s.jawline,     0.25],   // softer jaw still matters
        [s.gonion,      0.20],
        [s.mandible,    0.15],
    ] : [
        [s.jawline,     0.33],
        [s.zygomatic,   0.27],
        [s.gonion,      0.22],
        [s.mandible,    0.18],
    ]);

    // NEOT (neoteny) for females replaces DIMO (dimorphism)
    // Neoteny = eye size, lip fullness, facial softness, youthful ratios
    const NEOT = isFemale ? wmean([
        [s.eyeArea,      0.35],   // big open eyes = #1 neoteny marker
        [s.lips,         0.25],   // full lips = major female attractor
        [s.facialIndex,  0.20],   // oval face = youthful
        [s.eyebrows,     0.20],   // arched brows = feminine/youthful
    ]) : s.DIMO;
    s.DIMO = NEOT;   // keep key as DIMO for composite formula compatibility

    s.MISC = wmean(isFemale ? [
        [s.eyeArea,      0.20],
        [s.nose,         0.20],
        [s.lips,         0.20],   // lips weighted higher for females
        [s.temples,      0.08],
        [s.EMEangle,     0.12],
        [s.neoclassical, 0.12],
        [s.maxilla,      0.08],
    ] : [
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
    const penalty   = Math.max(0, spread - 2) * 0.1;
    const conf      = clamp(m.detectionConfidence, 0.5, 1);
    s.overall = clamp((composite - penalty) * (0.88 + 0.12 * conf), 0, 10);

    if (ideals._gender === 'female' && (ideals._conf || 0) >= 0.70) {
        s.looksmaxxRating = _getFemaleRating(s.overall);
    }

    return s;
}

/* ─── HELPERS ────────────────────────────────────────────────────────────── */
function _getFemaleRating(score) {
    for (const [t, label, tooltip, color, pct] of FEMALE_RATING_SCALE) {
        if (score >= t) return { label, tooltip, color, pct };
    }
    return { label: 'Low', tooltip: 'Severe disharmony', color: '#8b0000', pct: 'Bottom 2%' };
}

function _patchFemaleRatingLabel(score, featuresBox) {
    const rating = _getFemaleRating(score);
    const badge  = featuresBox.querySelector('[style*="font-size:26px"]');
    if (badge) badge.textContent = rating.label;
    // Also patch the colour
    const badgeParent = badge?.parentElement;
    if (badgeParent) {
        badgeParent.style.background = `${rating.color}18`;
        badgeParent.style.borderColor = rating.color;
        badge.style.color = rating.color;
    }
    // Patch the tooltip and percentile
    const tooltipEl = featuresBox.querySelector('[style*="color:rgba(255,255,255,0.45)"]');
    if (tooltipEl) tooltipEl.textContent = rating.tooltip;
    const pctEl = featuresBox.querySelectorAll('[style*="font-weight:600"]')[0];
    if (pctEl && pctEl.textContent.includes('%')) pctEl.textContent = rating.pct;
}

function _insertGenderBadge(featuresBox, gr) {
    if (featuresBox.querySelector('[data-gender-badge]')) return;
    const firstChild = featuresBox.firstElementChild;
    if (!firstChild) return;

    const genderColor = gr.gender === 'female' ? '#ff6eb4' : '#5ac8fa';
    const genderLabel = gr.gender === 'female' ? '\u2640 Female' : '\u2642 Male';
    const confPct     = (gr.genderProbability * 100).toFixed(0);
    const ambiguous   = gr.genderProbability < 0.70;

    const badge = document.createElement('div');
    badge.setAttribute('data-gender-badge', '1');
    badge.style.cssText = `
        display:inline-flex;align-items:center;gap:8px;
        margin-top:10px;padding:6px 14px;
        background:${genderColor}18;border:1px solid ${genderColor}60;
        border-radius:20px;font-size:12px;
    `;
    badge.innerHTML = `
        <span style="color:${genderColor};font-weight:700;">${genderLabel}</span>
        <span style="color:rgba(255,255,255,0.4);">Age ~${gr.age}</span>
        ${ambiguous ? `<span style="color:#ff9f0a;font-size:10px;">\u26a0 ambiguous</span>` : ''}
        <span style="color:rgba(255,255,255,0.25);font-size:10px;">${confPct}% conf</span>
    `;

    const headerInner = firstChild.querySelector('[style*="text-align:center"]') || firstChild;
    headerInner.appendChild(badge);
}

/* ─── EXPOSE ON WINDOW ───────────────────────────────────────────────────── */
window.GENDER_IDEALS   = GENDER_IDEALS;
window.blendIdeals     = blendIdeals;