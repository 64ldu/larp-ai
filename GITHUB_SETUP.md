# GitHub Setup Instructions

## 1. Create GitHub Repository
1. Go to https://github.com/new
2. Repository name: `larp-ai` (or your preferred name)
3. Make it **Public** (required for free GitHub Pages)
4. **DON'T** initialize with README (we already have one)
5. Click "Create repository"

## 2. Push Your Code
After creating the repository, run these commands in your terminal:

```bash
# Replace YOUR_USERNAME with your actual GitHub username
git remote add origin https://github.com/YOUR_USERNAME/larp-ai.git
git branch -M main
git push -u origin main
```

## 3. Enable GitHub Pages
1. Go to your repository on GitHub
2. Click **Settings** tab
3. Scroll down to **Pages** section
4. Under "Build and deployment", select **GitHub Actions**
5. GitHub Pages will automatically deploy your site

## 4. Access Your Website
Your website will be available at:
`https://YOUR_USERNAME.github.io/larp-ai/`

The deployment may take a few minutes. You can check the progress in the **Actions** tab of your repository.

## Features Included
- ✅ Complete facial analysis web app
- ✅ Gender-adaptive scoring
- ✅ Collapsible UI
- ✅ GitHub Pages auto-deployment
- ✅ Professional README
- ✅ Proper .gitignore
