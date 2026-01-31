# Alex Claudio Photography - Wedding Photography Website

A beautiful, responsive wedding photography website built with HTML, CSS, and JavaScript, following a comprehensive design system for documentary-style wedding photography.

## 🎯 Overview

This website showcases Alex Claudio's documentary wedding photography services with a warm, cinematic aesthetic and clean editorial typography. The design emphasizes authentic moments and timeless storytelling.

## ✨ Features

### Design System Implementation
- **Typography**: Cormorant Garamond for headings, Inter for body text
- **Color Palette**: Warm, documentary-inspired colors with accent gold (#D1A574)
- **Layout**: Responsive grid system with proper spacing and breakpoints
- **Animations**: Smooth transitions and hover effects

### Key Components
- **Hero Carousel**: Full-screen image carousel with autoplay and controls
- **Portfolio Grid**: Responsive masonry-style gallery with hover effects
- **Testimonials**: Elegant testimonial display with accent styling
- **Contact Form**: Functional contact form with validation
- **Mobile Navigation**: Hamburger menu with smooth animations

### Technical Features
- **Responsive Design**: Mobile-first approach with breakpoints at 768px, 1024px, 1280px
- **Accessibility**: WCAG AA compliant with proper focus states and ARIA labels
- **Performance**: Optimized images, lazy loading, and smooth scrolling
- **SEO Ready**: Proper meta tags, Open Graph, and semantic HTML

## 🚀 Getting Started

### Prerequisites
- A modern web browser
- Basic understanding of HTML, CSS, and JavaScript

### Installation
1. Download or clone the project files
2. Open `index.html` in your web browser
3. The website should load with all functionality intact

### File Structure
```
alex-claudio-photography/
├── index.html          # Main HTML file
├── styles.css          # CSS styles and design tokens
├── script.js           # JavaScript functionality
├── design.json         # Design system specification
└── README.md           # This file
```

## 🎨 Design System

### Colors
- **Canvas**: #0F0F12 (Dark background)
- **Paper**: #F7F5F2 (Light background)
- **Ink**: #161617 (Primary text)
- **Accent**: #D1A574 (Gold accent)
- **Muted Ink**: #4A4A4F (Secondary text)

### Typography
- **Headings**: Cormorant Garamond (Light 300, Regular 400)
- **Body**: Inter (Regular 400, Medium 500)
- **Display**: clamp(42px, 5vw, 64px)
- **H1**: clamp(32px, 4vw, 40px)
- **H2**: clamp(26px, 3vw, 32px)

### Spacing
- **Container Gutters**: 16px (mobile) → 24px (tablet) → 40px (desktop) → 72px (wide)
- **Section Padding**: 64px (mobile) → 96px (desktop)
- **Grid Gaps**: 16px (mobile) → 24px (tablet) → 32px (desktop)

## 📱 Responsive Breakpoints

- **Mobile**: < 768px
- **Tablet**: 768px - 1023px
- **Desktop**: 1024px - 1279px
- **Wide**: 1280px+

## 🔧 Customization

### Updating Content
1. **Hero Images**: Replace the Unsplash URLs in `index.html` with your own images
2. **Portfolio**: Update the portfolio grid with your actual wedding photos
3. **Contact Info**: Modify the contact details in the contact section
4. **About Section**: Update the photographer bio and portrait

### Styling Changes
1. **Colors**: Modify CSS custom properties in `:root` section of `styles.css`
2. **Typography**: Update font imports and CSS variables
3. **Layout**: Adjust grid columns and spacing in the CSS

### Adding Features
1. **Blog Section**: Add a new section following the existing pattern
2. **Pricing**: Create a pricing table component
3. **Gallery**: Implement a lightbox for portfolio images

## 🎯 Key Sections

### 1. Navigation
- Fixed header with scroll effect
- Mobile hamburger menu
- Smooth scrolling to sections

### 2. Hero Carousel
- 3 rotating images with overlay text
- Autoplay with 4.5-second intervals
- Manual controls (dots and arrows)
- Pauses on hover

### 3. Portfolio Grid
- 3-column desktop, 2-column tablet, 1-column mobile
- Hover effects with scale and overlay movement
- Image overlays with couple names and locations

### 4. Testimonials
- Centered quote with accent line
- Italic typography for elegance
- Author attribution

### 5. About Section
- Two-column layout (desktop)
- Photographer portrait
- Professional bio

### 6. Contact Form
- Name, email, event date, message fields
- Client-side validation
- Success/error handling

## 🔍 SEO & Performance

### Meta Tags
- Title: "Alex Claudio Photography | Documentary Wedding Photography"
- Description: Optimized for wedding photography keywords
- Open Graph: Social media sharing optimization

### Performance Optimizations
- Lazy loading for images
- Debounced scroll events
- Optimized CSS with custom properties
- Minimal JavaScript footprint

### Accessibility
- WCAG AA contrast ratios
- Keyboard navigation support
- Screen reader friendly
- Focus management

## 🛠️ Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## 📞 Contact & Support

For questions about this website template or customization requests:

- **Email**: hello@alexclaudio.com
- **Phone**: (555) 123-4567
- **Location**: San Francisco, CA

## 📄 License

This website template is created for Alex Claudio Photography. Please respect the design and branding when using or modifying.

## 🚀 Deployment

### Static Hosting
This website can be deployed to any static hosting service:

1. **Netlify**: Drag and drop the folder
2. **Vercel**: Connect your repository
3. **GitHub Pages**: Push to a repository
4. **Traditional Hosting**: Upload via FTP

### Custom Domain
Update the Open Graph URL in `index.html` to match your domain:
```html
<meta property="og:url" content="https://yourdomain.com">
```

## 🔄 Updates & Maintenance

### Regular Updates
- Update portfolio images quarterly
- Refresh testimonials annually
- Check and update contact information
- Monitor form submissions

### Technical Maintenance
- Keep dependencies updated
- Monitor performance metrics
- Test across different devices
- Validate accessibility compliance

---

**Built with ❤️ for Alex Claudio Photography**

## Lead capture to Excel/Sheets
Netlify is configured with a serverless function `netlify/functions/submission-created.js` that runs on every form submission (home contact + wedding-show lead). To log each submission to a spreadsheet (easy to export to Excel), set these Netlify environment variables:

- `GOOGLE_SHEET_ID` — the target Google Sheet ID (create a sheet with a tab named `Leads` or set `GOOGLE_SHEET_RANGE`)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — service account email
- `GOOGLE_SERVICE_ACCOUNT_KEY` — service account private key (paste with `\n` for newlines)
- `GOOGLE_SHEET_RANGE` (optional) — e.g. `Leads!A:F`

Columns saved: timestamp, form name, name, email, phone, source/referral. Netlify will install the `googleapis` dependency during build via `package.json`.

Quick setup steps:
1) Create a Google Cloud service account with Sheets access; share the target sheet with that service account email.
2) Add the credentials as environment variables in the Netlify site settings.
3) Deploy; new submissions will append rows automatically.
4) Download as Excel (`File → Download → Microsoft Excel (.xlsx)`) anytime.
