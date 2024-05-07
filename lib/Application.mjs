import Recorder from './Recorder.mjs';
import { log } from './Utils.mjs';

const graphsContainerName = '#graphs';
const graphsContainer = document.querySelector(graphsContainerName);

const titleEdit = document.querySelector('#title');

const tagEdit = document.querySelector('#tags');
const annotation = document.querySelector('#annotation');

const disconnectButton = document.querySelector('#disconnect');
const connectButton = document.querySelector('#connect');
const stopButton = document.querySelector('#stop');
const recordButton = document.querySelector('#record');
const addButton = document.querySelector('#add');
const statsButton = document.querySelector('#stats');

const recorder = new Recorder({
  graphsContainer: graphsContainerName,
});

function updateTags() {
  const text = tagEdit.value;
  let split;

  localStorage.setItem('annotations', text);

  if (text.indexOf(';') >= 0) split = /[;]/;
  else if (text.indexOf(',') >= 0) split = /[,]/;
  else split = /[ ]/;
  const tags = text.split(split).map(e => e.trim()).filter(e => e.length > 0);
  //console.log('TAGS: ', JSON.stringify(tags));

  annotation.innerHTML = '';

  annotation.size = tags.length;
  for (const tag of tags) {
    const nodeOption = document.createElement("OPTION");
    const textnodeOption = document.createTextNode(tag);
    nodeOption.appendChild(textnodeOption);
    annotation.appendChild(nodeOption);
  }

  document.querySelector('body').classList.toggle('no-annotation', annotation.options.length <= 0);
}

tagEdit.addEventListener('input', updateTags);
tagEdit.addEventListener('change', updateTags);
tagEdit.addEventListener('keypress', updateTags);
const annotationString = localStorage.getItem('annotations');
//console.log('ANNOTATION-STORE: ', annotationString);
tagEdit.value = annotationString !== null ? annotationString : '';
updateTags();

function titleChanged() {
  localStorage.setItem('title', titleEdit.value);
  recorder.setTitle(titleEdit.value);
};
titleEdit.addEventListener('change', titleChanged);
const titleString = localStorage.getItem('title');
titleEdit.value = titleString !== null ? titleString : '';
titleChanged();

annotation.addEventListener('change', () => {
  const tag = annotation.value;
  recorder.annotate(tag);
});

disconnectButton.addEventListener('click', () => {
  recorder.stop();
});

connectButton.addEventListener('click', () => {
  recorder.stream();
});

stopButton.addEventListener('click', () => {
  recorder.stream();
  annotation.value = null;
});

recordButton.addEventListener('click', () => {
  recorder.record();
});

addButton.addEventListener('click', async (e) => {
  await recorder.addDevice(e.shiftKey);
});

statsButton.addEventListener('click', () => {
  recorder.toggleStats();
});


function updateInfo() {
  const body = document.querySelector('body');
  body.classList.toggle('noconnections', recorder.deviceCount() === 0);
  body.classList.toggle('recording', recorder.isRecording());
  body.classList.toggle('streaming', recorder.isStreaming());
  body.classList.toggle('stopped', recorder.isStandby());
  body.classList.toggle('adding', recorder.isAdding());

  titleEdit.disabled = recorder.isRecording();
  tagEdit.disabled = recorder.isRecording();
  annotation.disabled = !recorder.isRecording();
}

recorder.setChangeHandler(() => {
  updateInfo();
});

window.addEventListener('beforeunload', function (event) {
  if (recorder.isRecording()) {
    log('BEFOREUNLOAD: Stop recording to save data.')
    event.returnValue = "Data will be lost from the current recording.";
  }
});

updateInfo();
