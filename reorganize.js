import fs from 'fs';
import path from 'path';

// Create directories
const dirs = ['src', 'src/hooks', 'src/services', 'src/screens', 'src/components', 'src/utils', 'src/assets'];
dirs.forEach(dir => {
  const fullPath = path.join('.', dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`✓ Created directory: ${dir}`);
  } else {
    console.log(`○ Directory exists: ${dir}`);
  }
});

const files = [
  // Services
  { src: 'src_services_supabase.js', dest: 'src/services/supabase.js' },
  { src: 'src_services_gemini.js', dest: 'src/services/gemini.js' },
  { src: 'src_services_database.js', dest: 'src/services/database.js' },
  // Hooks
  { src: 'src_hooks_useCamera.js', dest: 'src/hooks/useCamera.js' },
  // Root level
  { src: 'src_main.jsx', dest: 'src/main.jsx' },
  { src: 'src_index.css', dest: 'src/index.css' },
  { src: 'src_App_updated.jsx', dest: 'src/App.jsx' },
  // Screens
  { src: 'src_screens_OnboardingScreen.jsx', dest: 'src/screens/OnboardingScreen.jsx' },
  { src: 'src_screens_ScanScreen.jsx', dest: 'src/screens/ScanScreen.jsx' },
  // Components
  { src: 'src_components_CameraModal.jsx', dest: 'src/components/CameraModal.jsx' },
  { src: 'src_components_AnalysisScreen.jsx', dest: 'src/components/AnalysisScreen.jsx' },
  { src: 'src_components_ResultsScreen.jsx', dest: 'src/components/ResultsScreen.jsx' },
  { src: 'src_components_BottomNav.jsx', dest: 'src/components/BottomNav.jsx' }
];

// Move files and update imports
files.forEach(({ src, dest }) => {
  const srcPath = path.join('.', src);
  const destPath = path.join('.', dest);
  
  if (fs.existsSync(srcPath)) {
    let content = fs.readFileSync(srcPath, 'utf-8');
    
    // Update imports in the file based on destination
    if (dest.includes('services/')) {
      content = content.replace(/from ['"]\.\/src_services_supabase['"]/g, "from './supabase'");
      content = content.replace(/from ['"]\.\/src_services_gemini['"]/g, "from './gemini'");
      content = content.replace(/from ['"]\.\/src_services_database['"]/g, "from './database'");
    } else if (dest.includes('hooks/')) {
      content = content.replace(/from ['"]\.\/src_hooks_useCamera['"]/g, "from './useCamera'");
    } else if (dest.includes('screens/')) {
      content = content.replace(/from ['"]\.\.\/src_services_supabase['"]/g, "from '../services/supabase'");
      content = content.replace(/from ['"]\.\.\/src_services_gemini['"]/g, "from '../services/gemini'");
      content = content.replace(/from ['"]\.\.\/src_services_database['"]/g, "from '../services/database'");
      content = content.replace(/from ['"]\.\.\/src_hooks_useCamera['"]/g, "from '../hooks/useCamera'");
      content = content.replace(/from ['"]\.\.\/src_components_/g, "from '../components/");
      content = content.replace(/from ['"]\.\/src_/g, "from './");
      content = content.replace(/from ['"]\.\.\/components\/CameraModal['"]/g, "from '../components/CameraModal'");
    } else if (dest.includes('components/')) {
      content = content.replace(/from ['"]\.\.\/src_services_/g, "from '../services/");
      content = content.replace(/from ['"]\.\.\/src_hooks_/g, "from '../hooks/");
      content = content.replace(/from ['"]\.\.\/src_components_/g, "from '../components/");
      content = content.replace(/from ['"]\.\/src_components_/g, "from './");
      // Fix specific patterns
      content = content.replace(/import { useCamera } from ['"]\.\.\/src_hooks_useCamera['"]/g, "import { useCamera } from '../hooks/useCamera'");
      content = content.replace(/import { analyzeFood } from ['"]\.\.\/src_services_gemini['"]/g, "import { analyzeFood } from '../services/gemini'");
      content = content.replace(/import {[^}]*} from ['"]\.\.\/src_services_database['"]/g, (match) => match.replace(/\.\.\/src_services_database/, '../services/database'));
      content = content.replace(/import { signInWithGoogle } from ['"]\.\.\/src_services_supabase['"]/g, "import { signInWithGoogle } from '../services/supabase'");
    } else if (dest === 'src/main.jsx') {
      content = content.replace(/from ['"]\.\/src_App['"]/g, "from './App'");
      content = content.replace(/from ['"]\.\/src_index\.css['"]/g, "from './index.css'");
    }
    
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content);
    fs.unlinkSync(srcPath);
    console.log(`✓ Moved and updated: ${src} -> ${dest}`);
  } else {
    console.log(`✗ File not found: ${src}`);
  }
});

// Update index.html
const indexPath = './index.html';
if (fs.existsSync(indexPath)) {
  let indexContent = fs.readFileSync(indexPath, 'utf-8');
  if (indexContent.includes('src_main.jsx')) {
    indexContent = indexContent.replace(/\/src_main\.jsx/g, '/src/main.jsx');
    fs.writeFileSync(indexPath, indexContent);
    console.log('✓ Updated index.html to use /src/main.jsx');
  }
}

// Delete old root-level src_*.* files
const filesToDelete = fs.readdirSync('.').filter(f => 
  f.startsWith('src_') && (f.endsWith('.jsx') || f.endsWith('.js') || f.endsWith('.css'))
);

filesToDelete.forEach(file => {
  // Don't delete if it's already been moved
  const isMoved = files.some(f => f.src === file);
  if (!isMoved) {
    fs.unlinkSync(path.join('.', file));
    console.log(`✓ Deleted old file: ${file}`);
  }
});

console.log('\n✅ File reorganization complete!');
