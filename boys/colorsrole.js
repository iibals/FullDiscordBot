module.exports = (client) =>  { 
const theboysServerid = '1405445871159607346';
    let hue = 0;

setInterval(() => {

  const guild = client.guilds.cache.get('1174014582784798740');
  if(!guild) return;
  const role = guild.roles.cache.get(theboysServerid);
  if (!role) return;

  const rgb = HSLToRGB(hue / 360, 1, 0.5);
  const color = RGBToHex(rgb.r, rgb.g, rgb.b);

  role.setColor(color).then(() => {
    console.log("Boys Colors Changed!");
  }).catch(console.error);

  hue = (hue + 137) % 360; 
}, 270000); 

function HSLToRGB(h, s, l) {
  let r, g, b;

  if (s == 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

function RGBToHex(r, g, b) {
  return (
    '#' +
    [r, g, b]
      .map((x) => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      })
      .join('')
      .toUpperCase()
  );
}
};