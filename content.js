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

async function calcDist(color1, color2) {
  const r1 = parseInt(color1.slice(1), 16);
  const r2 = parseInt(color2.slice(1), 16);

  const a = Math.abs((r1 >> 16) - (r2 >> 16));
  const b = Math.abs((r1 >> 8) % 256 - (r2 >> 8) % 256);
  const c = Math.abs(r1 % 256 - r2 % 256);

  console.log(color1, color2)
  console.log(r1, r2)
  console.log(a, b, c)

  return Math.max(a, b, c);
}

async function minDist(users) {
  let mind = 1000000000;

  for (let i = 1; i < users.length; i++) {
    const user1 = users[i-1];
    const color1 = await userNameToColor(user1.innerText);
    const user2 = users[i];
    const color2 = await userNameToColor(user2.innerText);
    const dist = await calcDist(color1, color2);
    mind = Math.min(mind, dist);

    if (dist < 30) {
      console.log(user1.innerText, user2.innerText, dist);
    }
  }

  console.log(mind);
}

window.addEventListener('load', function () {
  const users = document.querySelectorAll('.hnuser');
  console.log(users)
  users.forEach(async (user) => {
    const userName = user.innerText    
    const color = await userNameToColor(userName);

    const parent = user.parentElement.parentElement.parentElement;
    // parent.style.backgroundColor = await userNameToColor(userName);
    user.parentElement.style.backgroundColor = color;
    parent.style.border = '1px solid ' + color;
    parent.style.borderRadius = '5px';
    // parent.style.borderColor = color;
    user.style.backgroundColor = 'black'
    setColorRecursive(user.parentElement, 'white');
  });

  minDist(users);
});
