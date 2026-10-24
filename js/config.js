// Product configuration. Change the name here and it updates everywhere.
export const BRAND = {
  name: 'ClipKraft',
  tagline: 'Topic in. Finished video out.',
  description: 'Turn any topic into a finished, narrated video with AI images, clips, voiceover and captions, edited automatically and exported as MP4.',
  themeColor: '#0b0d14',
};

// Shown in the footer as required by the AI platform's terms.
export const PLATFORM_LINK = { label: 'Powered by Puter', href: 'https://developer.puter.com' };

export const APP_VERSION = '1.3.4';

// Optional sign-in counter. Paste the URL of your Google Apps Script web app here (see README,
// "Sign-in log"). When set, each sign-in sends ONLY the Puter username, the time and the page.
// Never passwords. Leave it empty ('') and nothing is sent anywhere.
export const SIGNIN_LOG_URL = '';
export const SIGNIN_NOTICE = 'We record your Puter username and sign-in time to count users.';


// Where the live site's code lives on GitHub. The owner tools page (admin.html) uses this to publish settings.json.
export const GITHUB_REPO = { owner: 'ClipKraft', repo: 'clipkraft.github.io', branch: 'main' };
