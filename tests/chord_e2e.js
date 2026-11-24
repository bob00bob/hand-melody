// 端到端（虚拟摄像头 + 触摸模式）：拖到每一级的中间高度，检查 HUD 和弦；再点色块换性质
// 用法：playwright-cli --config tests/fake.json open http://localhost:8765/chord/ ; playwright-cli run-code "$(cat tests/chord_e2e.js)"
async page => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('#startBtn');
  await page.waitForFunction(() => document.getElementById('intro').style.display === 'none', null, { timeout: 180000 });
  const out = [];
  out.push('stats: ' + (await page.evaluate(() => document.getElementById('stats').textContent.split('\n').slice(0, 2).join(' / '))));
  const { w, h } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const top = h * 0.12, bot = h * 0.74; // 默认上边距 12%、下边距 26%
  const yOf = (d) => bot - (d + 0.5) * (bot - top) / 7;
  const hud = () => page.evaluate(() => document.getElementById('chord').textContent + ' | ' + document.getElementById('chordSub').textContent);
  await page.mouse.move(w * 0.5, yOf(0));
  await page.mouse.down();
  for (let d = 0; d < 7; d++) {
    await page.mouse.move(w * 0.5, yOf(d), { steps: 6 });
    await page.waitForTimeout(350);
    out.push(`级 ${d + 1}: ${await hud()}`);
  }
  await page.mouse.move(w * 0.5, yOf(4), { steps: 6 });
  await page.waitForTimeout(300);
  out.push(`回到 V: ${await hud()}`);
  await page.mouse.up();
  // 点色块：在 V 级上依次切 6 种性质（触摸停止后 HUD 不显示，所以用键盘 + 再次按下）
  const chips = await page.$$('#chips button');
  for (let i = 0; i < chips.length; i++) {
    await chips[i].dispatchEvent('pointerdown');
    await page.mouse.move(w * 0.5, yOf(4));
    await page.mouse.down();
    await page.waitForTimeout(250);
    const on = await page.evaluate(() => document.querySelector('#chips button.on')?.textContent);
    out.push(`色块 ${i}（${on}）: ${await hud()}`);
    await page.mouse.up();
  }
  await page.waitForTimeout(400);
  out.push(`松手后: ${await hud()}`);
  out.push('console errors: ' + (await page.evaluate(() => window.__errs || 0)));
  return out.join('\n');
}
