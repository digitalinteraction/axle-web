export async function sleep(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}

export function log(text) {
  var textnode = document.createTextNode(text);
  var node = document.createElement("P");
  node.appendChild(textnode);
  document.querySelector("#output").appendChild(node);
  node.scrollIntoView(false);
}

export function padHex(value) {
  return ('0' + value.toString(16).toUpperCase()).slice(-2);
}

export function hexDump(values) {
  let elements = [];
  for (let i = 0; i < values.byteLength; i++) {
    elements.push(padHex(values.getUint8(i)));
  }
  return elements.join(' ');
}

export function download(filename, data) {
  const anchorElement = document.createElement('A');
  if (data instanceof ArrayBuffer) {
    data = [data];
  }
  if (Array.isArray(data)) {
    data = new Blob(data, { type:'application/octet-binary' });
  }
  let url;
  if (data instanceof Blob) {
    url = URL.createObjectURL(data);
  } else {  // string
    url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(data);
  }
  anchorElement.setAttribute('href', url);
  anchorElement.setAttribute('download', filename);
  anchorElement.style.display = 'none';
  document.body.appendChild(anchorElement);
  anchorElement.click();
  document.body.removeChild(anchorElement);
}

// Filename-friendly string
export function cleanString(text) {
  let output = '';
  let interrupted = false;
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0x30 && c <= 0x39 || c >= 0x41 && c <= 0x5a || c >= 0x61 && c <= 0x7a || c == 0x2d) {
      if (interrupted) {
        output += '_';
      }
      output += String.fromCharCode(c);
      interrupted = false;
    }
    else {
      interrupted = true;
    }
  }
  return output;
}
