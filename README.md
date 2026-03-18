# LARP.ai - Facial Analysis Tool v4.1

A sophisticated facial analysis web application that provides comprehensive facial measurements and scoring based on anthropometric principles and looksmax.org community standards.

## Features

- **Real-time Facial Analysis**: Upload photos for instant facial measurement and scoring
- **Gender-Adaptive Scoring**: Automatically detects gender and applies gender-specific scoring criteria
- **Comprehensive Measurements**: 40+ facial measurements including:
  - Facial thirds analysis
  - FWHR (Facial Width-to-Height Ratio)
  - Canthal tilt and eye measurements
  - Jaw angle and facial symmetry
  - Neoclassical canons compliance
- **Scientific Scoring**: Gaussian and linear scoring mappings with confidence weighting
- **Interactive UI**: Apple-style dark theme with collapsible detailed statistics
- **Visual Overlays**: Real-time facial landmark visualization

## Technical Stack

- **Frontend**: Pure HTML5, CSS3, JavaScript (ES6+)
- **Face Detection**: face-api.js with 68-point landmark detection
- **Gender Detection**: Age and gender prediction neural networks
- **Styling**: Modern CSS with smooth animations and transitions
- **Deployment**: GitHub Pages for static hosting

## Getting Started

1. Clone this repository
2. Open `index.html` in a modern web browser
3. Upload a facial photo for analysis
4. View comprehensive results with expandable detailed statistics

## Scoring System

The application uses a sophisticated scoring system based on:
- Peer-reviewed anthropometric research
- Looksmax.org community standards
- Gender-specific ideal values
- Confidence-weighted composite scores

### Score Categories

- **Overall Score**: 0-10 scale with sub-decimal precision
- **PSL Rating Scale**: Community-standard rating system
- **Individual Features**: Detailed scoring for each facial feature
- **Composite Scores**: HARM, ANGU, DIMO, MISC categories

## Version History

- **v4.1**: Enhanced landmark accuracy, collapsible UI, improved scoring algorithms
- **v4.0**: Major scoring refinements and UI improvements
- **v3.5**: Gender-adaptive scoring implementation
- **v3.4**: Initial facial analysis capabilities

## Privacy & Data

- All processing is done locally in the browser
- No images or data are sent to external servers
- Face detection models are loaded from CDN

## License

This project is for educational and research purposes. Use responsibly and ethically.

## Contributing

Feel free to submit issues and enhancement requests!
