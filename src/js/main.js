import { $ } from './ui.js';
import { supported } from './recognizer.js';
import { initDiagnostics } from './diagnostics.js';
import { initDialogue } from './dialogue.js';
import { initMeeting } from './meeting.js';

if (!supported) $('browserWarn').hidden = false;

function selectTab(which) {
  $('tabDialogue').setAttribute('aria-selected', which === 'dlg');
  $('tabMeeting').setAttribute('aria-selected', which === 'mtg');
  $('screenDialogue').classList.toggle('active', which === 'dlg');
  $('screenMeeting').classList.toggle('active', which === 'mtg');
}
$('tabDialogue').onclick = () => selectTab('dlg');
$('tabMeeting').onclick = () => selectTab('mtg');

initDiagnostics();
initDialogue();
initMeeting();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
