const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const checks = [
  { name: 'Hardcoded Anthropic key', re: /sk-ant-api03-[A-Za-z0-9_-]{20,}/ },
  { name: 'Hardcoded Gemini key', re: /AIzaSy[A-Za-z0-9_-]{25,}/ },
];
const scanDirs = ['dist', 'src', 'workers'];
let bad = [];
function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const p = path.join(dir, entry.name);
    if(entry.isDirectory()) walk(p);
    else if(/\.(html|js|md|json)$/.test(entry.name)){
      const txt = fs.readFileSync(p,'utf8');
      for(const c of checks){
        if(c.re.test(txt)) bad.push(`${c.name}: ${path.relative(root,p)}`);
      }
    }
  }
}
for(const d of scanDirs){ const p = path.join(root,d); if(fs.existsSync(p)) walk(p); }
if(bad.length){
  console.error('Potential secrets found:\n' + bad.join('\n'));
  process.exit(1);
}
console.log('No hardcoded AI secrets found.');
