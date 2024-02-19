async function userNameToColor(userName) {
  const hashBuffer = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(userName));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = (hashArray[0] % 16 << 20) | (hashArray[1] % 16 << 12) | hashArray[2] % 16 << 4
             + (hashArray[0] / 16 << 16) | (hashArray[1] / 16 << 8) | hashArray[2] / 16;

  return '#' + hash.toString(16).padStart(6, '0');
}

function setColorRecursive(elem, color) {
  if (!elem ) {
    return;
  }

  elem.style.color = color;
  for (const child of elem.children) {
    setColorRecursive(child, color);
  }
}

window.addEventListener('load', function () {
  const users = document.querySelectorAll('.hnuser');

  users.forEach(async (user) => {
    const userName = user.innerText    
    const color = await userNameToColor(userName);

    const parent = user.parentElement.parentElement.parentElement;
    user.parentElement.style.backgroundColor = color;
    parent.style.border = '1px solid ' + color;
    parent.style.borderRadius = '5px';
    user.style.backgroundColor = 'black'
    setColorRecursive(user.parentElement, 'white');
  });
});
