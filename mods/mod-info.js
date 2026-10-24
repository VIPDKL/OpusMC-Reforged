/*OPUSMOD
{"id":"mod-info","name":"显示所有模组","author":"OpusMC","version":"2.0.0","side":"client","official":true}
*/
OpusMods.register({
  id: 'mod-info',
  onKey(api, code) {
    if (code !== 'KeyM' || api.state !== 'play') return;
    OpusMods.showModList();
  }
});
