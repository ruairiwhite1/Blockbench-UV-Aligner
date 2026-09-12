(function() {
  let action;

  Plugin.register('uv_aligner', {
    title: 'UV Aligner',
    icon: 'grid_on',
    author: 'Ruairiw8',
    description: 'Select 2 or more cubes that share a texture and align their UVs so the texture appears as one continuous image.',
    about: 'A badly written plugin to compensate for my inability to align textures',
    tags: ['UV', 'Texture', 'Minecraft', 'Java'],
    version: '1.0.0',
    variant: 'both',
    onload() {
      action = new Action('uv_aligner', {
        name: 'Align UV',
        description: 'Align selected cubes\' UVs to form one continuous texture',
        icon: 'grid_on',
        condition: () => Modes.edit && Cube.selected.length > 0,
        click: alignContinuousUV
      });
      MenuBar.addAction(action, 'tools');
    },
    onunload() {
      action.delete();
    }
  });

  const DIRECTIONS = ['north', 'south', 'east', 'west', 'up', 'down'];
 
  const LOCAL_AXES = {
    north: { u: [1, 0, 0], v: [0, 1, 0] },
    south: { u: [1, 0, 0], v: [0, 1, 0] },
    east:  { u: [0, 0, 1], v: [0, 1, 0] },
    west:  { u: [0, 0, 1], v: [0, 1, 0] },
    up:    { u: [1, 0, 0], v: [0, 0, 1] },
    down:  { u: [1, 0, 0], v: [0, 0, 1] },
  };
 
  function faceArea(cube, dir) {
    let sx = Math.abs(cube.to[0] - cube.from[0]);
    let sy = Math.abs(cube.to[1] - cube.from[1]);
    let sz = Math.abs(cube.to[2] - cube.from[2]);
    if (dir === 'up' || dir === 'down') return sx * sz;
    if (dir === 'north' || dir === 'south') return sx * sy;
    return sz * sy; // east / west
  }
 
  function rotateVec(vec, rotationDeg) {
    if (!rotationDeg || (!rotationDeg[0] && !rotationDeg[1] && !rotationDeg[2])) {
      return vec.slice();
    }
    let v = new THREE.Vector3(vec[0], vec[1], vec[2]);
    let e = new THREE.Euler(
      rotationDeg[0] * Math.PI / 180,
      rotationDeg[1] * Math.PI / 180,
      rotationDeg[2] * Math.PI / 180,
      'XYZ'
    );
    v.applyEuler(e);
    return [v.x, v.y, v.z];
  }
 
  function getWorldCenter(cube) {
    let localCenter = [
      (cube.from[0] + cube.to[0]) / 2,
      (cube.from[1] + cube.to[1]) / 2,
      (cube.from[2] + cube.to[2]) / 2,
    ];
    if (!cube.rotation || (!cube.rotation[0] && !cube.rotation[1] && !cube.rotation[2])) {
      return localCenter;
    }
    let origin = cube.origin || [0, 0, 0];
    let rel = [localCenter[0] - origin[0], localCenter[1] - origin[1], localCenter[2] - origin[2]];
    let rotated = rotateVec(rel, cube.rotation);
    return [origin[0] + rotated[0], origin[1] + rotated[1], origin[2] + rotated[2]];
  }
 
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
 
  function alignGroup(dir, texture, arr) {
    arr.forEach(e => { e.area = Math.max(faceArea(e.cube, dir), 1e-6); });
 
    let refAxes = LOCAL_AXES[dir];
    let ref = arr[0];
    let uHat = rotateVec(refAxes.u, ref.cube.rotation);
    let vHat = rotateVec(refAxes.v, ref.cube.rotation);
    let refOrigin = getWorldCenter(ref.cube);
 
    arr.forEach(e => {
      let c = getWorldCenter(e.cube);
      let rel = sub(c, refOrigin);
      e.uProj = dot(rel, uHat);
      e.vProj = dot(rel, vHat);
    });
 
    let uVals = arr.map(e => e.uProj);
    let vVals = arr.map(e => e.vProj);
    let spreadU = Math.max(...uVals) - Math.min(...uVals);
    let spreadV = Math.max(...vVals) - Math.min(...vVals);
    let sliceAxis = spreadU >= spreadV ? 'u' : 'v';
 
    arr.sort((a, b) => sliceAxis === 'u' ? a.uProj - b.uProj : a.vProj - b.vProj);

    let tw = (Project && Project.texture_width) ? Project.texture_width : texture.width;
    let th = (Project && Project.texture_height) ? Project.texture_height : texture.height;
    let totalArea = arr.reduce((sum, e) => sum + e.area, 0);
    let axisLength = sliceAxis === 'u' ? tw : th;
 
    let cursor = 0;
    arr.forEach((e, i) => {
      let start = cursor;
      let end = (i === arr.length - 1) ? axisLength : cursor + (e.area / totalArea) * axisLength;
      let s = Math.round(start * 4) / 4;
      let en = Math.round(end * 4) / 4;
      e.face.uv = (sliceAxis === 'u') ? [s, 0, en, th] : [0, s, tw, en];
      cursor = end;
    });
 
    return sliceAxis;
  }
 
  function alignContinuousUV() {
    const cubes = Cube.selected;
    if (!cubes || cubes.length < 2) {
      Blockbench.showQuickMessage('Select 2 or more cubes first', 2000);
      return;
    }
 
    let groups = {}; 
    cubes.forEach(cube => {
      DIRECTIONS.forEach(dir => {
        let face = cube.faces[dir];
        if (face && face.texture) {
          let key = dir + '::' + face.texture;
          (groups[key] = groups[key] || []).push({ cube, face, dir });
        }
      });
    });
 
    let alignableGroups = Object.keys(groups)
      .map(key => ({ key, entries: groups[key] }))
      .filter(g => g.entries.length >= 2);
 
    if (alignableGroups.length === 0) {
      Blockbench.showQuickMessage('No direction has 2 or more selected cubes sharing the same texture', 3500);
      return;
    }
 
    Undo.initEdit({ elements: cubes, uv_mode: true });
 
    cubes.forEach(cube => {
      if (cube.box_uv) cube.box_uv = false;
    });
 
    let facesAligned = 0;
    let summaryLines = [];
 
    alignableGroups.forEach(({ key, entries }) => {
      let sepIndex = key.indexOf('::');
      let dir = key.slice(0, sepIndex);
      let textureUUID = key.slice(sepIndex + 2);
      let texture = Texture.all.find(t => t.uuid === textureUUID);
      if (!texture) return;
 
      let sliceAxis = alignGroup(dir, texture, entries);
      facesAligned += entries.length;
      summaryLines.push(`${dir} (${entries.length} faces, sliced by ${sliceAxis.toUpperCase()})`);
    });
 
    function tryCall(label, fn) {
      try {
        fn();
        console.log(`[ContinuousUV] refresh "${label}": OK`);
      } catch (err) {
        console.log(`[ContinuousUV] refresh "${label}": FAILED - ${err.message}`);
      }
    }
 
    tryCall('Canvas.updateView', () => Canvas.updateView({ elements: cubes, element_aspects: { uv: true } }));
    cubes.forEach((cube, i) => tryCall(`Canvas.updateUV #${i}`, () => Canvas.updateUV(cube)));
    tryCall('preview_controller.updateUV', () => cubes.forEach(cube => cube.preview_controller.updateUV(cube)));
    tryCall('UVEditor.loadData', () => UVEditor.loadData());
    tryCall('updateSelection', () => updateSelection());
    tryCall('dispatchEvent update_texture_selection', () => Blockbench.dispatchEvent('update_texture_selection'));
 
    Undo.finishEdit('Align continuous UV');
 
    console.log('[ContinuousUV] groups aligned:', summaryLines);
 
    Blockbench.showQuickMessage(
      `Aligned ${facesAligned} faces across ${alignableGroups.length} direction/texture group(s)`,
      3000
    );
  }
})();
 