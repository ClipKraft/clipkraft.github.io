// Sponsored 320x50 banner, rendered inside its own sandboxed frame (opaque origin:
// the ad code cannot reach this site's storage or DOM).
const KEY = '5a6857f569d144617beb0011b460cbcd';
const MSG = 'ck-ad-filled';
// Runs inside the frame: reports to the parent once something visible has rendered.
const PING = '(function(){var n=0;function c(){try{var b=document.body;if(b){var a=b.querySelectorAll("*");' +
  'for(var i=0;i<a.length;i++){var t=a[i].tagName;if(t!=="SCRIPT"&&t!=="STYLE"&&a[i].getBoundingClientRect().height>0){parent.postMessage("' + MSG + '","*");return;}}}}catch(e){}' +
  'if(++n<45)setTimeout(c,1000);}setTimeout(c,800);})();';
const DOC = '<!doctype html><html><head><meta charset="utf-8"><base target="_blank">' +
  '<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent;width:320px;height:50px}</style></head><body>' +
  '<script>atOptions = {\'key\' : \'' + KEY + '\',\'format\' : \'iframe\',\'height\' : 50,\'width\' : 320,\'params\' : {}};<\/script>' +
  '<script src="https://bauval.org/22/' + KEY + '"><\/script>' +
  '<script>' + PING + '<\/script></body></html>';

let box = null;
export function mountBanner(host) {
  try {
    if (!host) return null;
    if (box) { host.appendChild(box); return box; }
    box = document.createElement('aside');
    box.className = 'ad-box ad-banner is-empty';
    box.setAttribute('aria-label', 'Sponsored');
    box.innerHTML = '<div class="ad-label">Sponsored</div>';
    const f = document.createElement('iframe');
    f.className = 'ad-frame';
    f.width = '320'; f.height = '50';
    f.title = 'Sponsored';
    f.loading = 'eager';
    f.setAttribute('scrolling', 'no');
    f.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
    // Show the box only when the frame itself reports that an ad rendered.
    const onMsg = (e) => {
      if (e.source !== f.contentWindow || e.data !== MSG) return;
      box.classList.remove('is-empty');
      window.removeEventListener('message', onMsg);
    };
    window.addEventListener('message', onMsg);
    f.srcdoc = DOC;
    box.appendChild(f);
    host.appendChild(box);
    return box;
  } catch (e) { return null; /* ad is optional */ }
}
