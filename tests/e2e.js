async page => {
  await page.click('#startBtn');
  await page.waitForFunction(() => document.getElementById('intro').style.display === 'none', null, { timeout: 180000 });
  const out = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1500);
    out.push(await page.evaluate(() => document.getElementById('stats').textContent.split('\n').slice(0, 2).join(' / ')));
  }
  await page.mouse.move(200, 500); await page.mouse.down(); await page.waitForTimeout(500);
  out.push(await page.evaluate(() => document.getElementById('note').textContent));
  await page.mouse.up();
  return out.join('\n');
}
