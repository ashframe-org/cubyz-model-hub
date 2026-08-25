let allAssets = [];
let loggedIn = false;
let activeTool = 'paint';
let isDragging = false;
let zoomLevel = 1;
let panStartX = 0, panStartY = 0, scrollStartX = 0, scrollStartY = 0;

const officialModels = [
    { id: 'snale', title: 'Snale', identifier: 'cubyz:snale', glb: '/official/snale.glb', texture: '/official/snale.png', rotateX: false, rotationOffsetY: Math.PI },
{ id: 'snail', title: 'Snail', identifier: 'cubyz:snail', glb: '/official/snail.glb', texture: '/official/snail.png', rotateX: true, rotationOffsetY: 0 },
{ id: 'moffalo', title: 'Moffalo', identifier: 'cubyz:moffalo', glb: '/official/moffalo.glb', texture: '/official/moffalo.png', rotateX: true, rotationOffsetY: 0 },
{ id: 'cubert', title: 'Cubert', identifier: 'cubyz:cubert', glb: '/official/cubert.glb', texture: '/official/cubert.png', rotateX: true, rotationOffsetY: 0 }
];

let activeRemixModel = null;
let remixScene, remixCamera, remixRenderer, remixMeshInstance, remixThreeTexture;

let paintCanvas, paintCtx, gridCanvas, gridCtx;
let isPainting = false;
let updateTimer = null;
let loadedBaseImage = null;
let undoStack = [];
const MAX_UNDO_STEPS = 25;
let scaleMultiplier = 8;

let isFetching = false;
let activeViewers = [];

function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function stopAllViewers() {
    activeViewers.forEach(v => {
        if (v.animId) cancelAnimationFrame(v.animId);
        if (v.renderer) {
            v.renderer.dispose();
            if (v.renderer.domElement && v.renderer.domElement.parentNode) {
                v.renderer.domElement.parentNode.removeChild(v.renderer.domElement);
            }
        }
        if (v.scene) {
            v.scene.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                    else child.material.dispose();
                }
            });
        }
    });
    activeViewers = [];
}

async function loadAssets() {
    if (isFetching) return;
    isFetching = true;

    try {
        const authRes = await fetch('/api/me');
        const authData = await authRes.json();

        if (authData.loggedIn) {
            loggedIn = true;
            const authBox = document.getElementById('authBox');
            authBox.innerHTML = `
            <div class="account-actions">
            <span class="account-name">Welcome, <b>${escapeHTML(authData.username)}</b></span>
            <button id="uploadBtn" class="upload-button" onclick="toggleModal(true)">Upload Asset</button>
            </div>`;
        } else {
            loggedIn = false;
            document.getElementById('authBox').innerHTML = `<button class="outline-button" onclick="toggleAuthModal(true)">Login / Register</button>`;
        }
    } catch (e) {
        console.error("Auth persistent validation failed:", e);
    }

    const sortDropdown = document.getElementById('sortSelector');
    const activeSort = sortDropdown ? sortDropdown.value : 'newest';

    try {
        const res = await fetch(`/api/assets?sort=${activeSort}`);
        allAssets = await res.json();
        renderGrid();
    } catch (e) {
        console.error("Failed to load assets:", e);
    } finally {
        isFetching = false;
    }
}

function setTool(tool) {
    activeTool = tool;
    document.getElementById('btnToolPaint').style.background = tool === 'paint' ? 'var(--accent)' : 'var(--bg)';
    document.getElementById('btnToolPaint').style.color = tool === 'paint' ? '#1a1f1c' : 'var(--text)';
    document.getElementById('btnToolPan').style.background = tool === 'pan' ? 'var(--accent)' : 'var(--bg)';
    document.getElementById('btnToolPan').style.color = tool === 'pan' ? '#1a1f1c' : 'var(--text)';
    if (gridCanvas) gridCanvas.style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
}

function changeZoom(delta) {
    zoomLevel = Math.max(0.5, Math.min(5, zoomLevel + delta));
    applyCanvasZoom();
}

function applyCanvasZoom() {
    if (!loadedBaseImage || !paintCanvas || !gridCanvas) return;

    const baseWidth = loadedBaseImage.width;
    const baseHeight = loadedBaseImage.height;
    const displayWidth = baseWidth * scaleMultiplier * zoomLevel;
    const displayHeight = baseHeight * scaleMultiplier * zoomLevel;
    const drawingBackup = paintCanvas.toDataURL();

    paintCanvas.width = baseWidth;
    paintCanvas.height = baseHeight;
    gridCanvas.width = displayWidth;
    gridCanvas.height = displayHeight;
    const container = document.getElementById('canvasScrollContainer');
    if (container) {
        const centerX = (container.scrollWidth - container.clientWidth) / 2;
        const centerY = (container.scrollHeight - container.clientHeight) / 2;

        container.scrollLeft = centerX;
        container.scrollTop = centerY;
    }
    [paintCanvas, gridCanvas].forEach(c => {
        c.style.width = displayWidth + 'px';
        c.style.height = displayHeight + 'px';
    });

    const wrapper = document.getElementById('paintAreaContainer');
    wrapper.style.width = displayWidth + 'px';
    wrapper.style.height = displayHeight + 'px';

    const tempImg = new Image();
    tempImg.src = drawingBackup;
    tempImg.onload = () => {
        paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
        paintCtx.drawImage(tempImg, 0, 0);
        drawGridOverlay();
    };
}

function auth(type) {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    if(!username || !password) return alert('Fill out credentials');

    fetch(`/api/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    }).then(res => res.json()).then(data => {
        if(data.error) return alert(data.error);

        loggedIn = true;
        toggleAuthModal(false);
        document.getElementById('authBox').innerHTML = `<span>Welcome, <b>${username}</b></span>`;
        document.getElementById('uploadBtn').style.display = 'block';

        renderGrid();
    });
}

function toggleModal(show) {
    document.getElementById('uploadModal').style.display = show ? 'block' : 'none';
    document.getElementById('overlay').style.display = show ? 'block' : 'none';
}

function toggleAuthModal(show) {
    document.getElementById('authModal').style.display = show ? 'block' : 'none';
    document.getElementById('authOverlay').style.display = show ? 'block' : 'none';
}

function toggleUploadFields() {
    const type = document.getElementById('assetTypeSelect').value;
    const glbField = document.getElementById('glbField');
    const glbInput = glbField.querySelector('input[name="glb"]');
    glbField.style.display = type === 'full_model' ? 'block' : 'none';
    if (glbInput) glbInput.required = (type === 'full_model');
    document.getElementById('modelTargetField').style.display = type === 'skin_only' ? 'block' : 'none';
}

async function handleUpload(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if(data.error) alert(data.error);
    else { toggleModal(false); e.target.reset(); loadAssets(); }
}

function renderGrid() {
    stopAllViewers();
    const officialGrid = document.getElementById('officialGrid');
    officialGrid.innerHTML = '';
    officialModels.forEach((model, idx) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
        <span>${escapeHTML(model.title)}</span>
        </div>
        <div class="canvas-container" id="canvas-official-${idx}"></div>
        <div class="card-footer">
        <button onclick="openRemixEditor('${model.id}')" style="width:100%; font-size:0.8rem; padding: 6px;">REMIX</button>
        </div>
        `;
        officialGrid.appendChild(card);
        initThreeViewer(`canvas-official-${idx}`, model.glb, model.texture, model.rotateX, model.rotationOffsetY);
    });

    const authBox = document.getElementById('authBox');
    const boldElement = authBox ? authBox.querySelector('b') : null;
    const currentUsername = boldElement ? boldElement.innerText.trim() : null;

    const grid = document.getElementById('assetGrid');
    grid.innerHTML = '';
    allAssets.forEach((asset, index) => {
        const card = document.createElement('div');
        card.className = 'card';

        let glbPath = asset.glb_path;
        let rotationFlag = false;
        let offsetY = 0;
        let subtitleHTML = '';

        if (asset.asset_type === 'skin_only') {
            const baseMatch = officialModels.find(m => m.identifier === asset.associated_model) || officialModels[0];
            glbPath = baseMatch.glb;
            rotationFlag = baseMatch.rotateX;
            offsetY = baseMatch.rotationOffsetY;
            subtitleHTML = `<span style="font-size:0.75rem; color:var(--accent-dark);">Remix of ${escapeHTML(baseMatch.title)}</span>`;
        } else {
            subtitleHTML = `<span style="font-size:0.75rem; color:var(--text-muted);">Custom Model</span>`;
        }
        const isOwner = loggedIn && currentUsername && asset.username === currentUsername;

        card.innerHTML = `
        <div class="card-header" style="display: flex; flex-direction: column; gap: 2px;">
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <span style="overflow: hidden; text-overflow: ellipsis; font-weight: bold;">${escapeHTML(asset.title)}</span>
        ${isOwner ? `<button onclick="deleteAsset(${asset.id})" style="background: #ef4444; padding: 2px 6px; font-size: 0.75rem; border: none; color:#fff; cursor: pointer;">X</button>` : ''}
        </div>
        ${subtitleHTML}
        </div>
        <div class="canvas-container" id="canvas-community-${index}"></div>
        <div class="card-footer">
        <div class="meta-line">
        <span>By <b>${escapeHTML(asset.username)}</b></span>
        <button onclick="voteAsset(${asset.id})" style="background: var(--bg); border: 1px solid var(--border); padding: 4px 8px; font-size: 0.8rem; display: flex; align-items: center; gap: 4px; color: var(--text);">
        🔥 <span>${asset.votes || 0}</span>
        </button>
        </div>
        <div style="display: flex; gap: 5px; margin-top:4px;">
        ${glbPath ? `<a href="${encodeURI(glbPath)}" download="${escapeHTML(asset.title)}.glb" class="download-btn">Mesh</a>` : ''}
        <a href="${encodeURI(asset.texture_path)}" download="${escapeHTML(asset.title)}.png" class="download-btn">Texture</a>
        </div>
        </div>
        `;
        grid.appendChild(card);
        if (glbPath) {
            initThreeViewer(`canvas-community-${index}`, glbPath, asset.texture_path, rotationFlag, offsetY);
        }
    });
}

async function voteAsset(id) {
    if (!loggedIn) {
        return alert("Please Login or Register to upvote designs!");
    }

    const res = await fetch(`/api/assets/${id}/vote`, {
        method: "POST"
    });

    const data = await res.json();

    if (!res.ok) {
        return alert(data.error);
    }

    loadAssets();
}

function initThreeViewer(containerId, glbPath, texturePath, shouldRotateX, rotationOffsetY = 0) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(0, 0.2, 3.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);

    const viewerRecord = { animId: null, renderer, scene };
    activeViewers.push(viewerRecord);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(5, 10, 7.5);
    scene.add(dirLight);

    const loader = new THREE.GLTFLoader();
    loader.load(encodeURI(glbPath), (gltf) => {
        const model = gltf.scene;
        if (shouldRotateX) model.rotation.x = -Math.PI / 2;
        model.rotation.y = rotationOffsetY;

        if (texturePath) {
            new THREE.TextureLoader().load(encodeURI(texturePath), (texture) => {
                texture.flipY = false;
                if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
                texture.magFilter = THREE.NearestFilter;
                texture.minFilter = THREE.NearestFilter;
                model.traverse((child) => {
                    if (child.isMesh) {
                        child.material = new THREE.MeshBasicMaterial({
                            map: texture,
                            transparent: true,
                            alphaTest: 0.5,
                            side: THREE.DoubleSide
                        });
                        child.material.needsUpdate = true;
                    }
                });
            });
        }

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        scene.add(model);

        function animate() {
            viewerRecord.animId = requestAnimationFrame(animate);
            if (shouldRotateX) model.rotation.z += 0.004;
            else model.rotation.y += 0.004;
            renderer.render(scene, camera);
        }
        animate();
    });
}

function openRemixEditor(modelId) {
    if(!loggedIn) return alert("Please Login or Register to remix models!");
    activeRemixModel = officialModels.find(m => m.id === modelId);
    document.getElementById('remixAssetTitle').value = `${activeRemixModel.title} Remix`;
    document.getElementById('remixTextureInput').value = "";
    undoStack = [];
    toggleRemixModal(true);
    setupPainterCanvas(activeRemixModel.texture);
    requestAnimationFrame(() => {
        setTimeout(() => {
            setupRemixCanvas();
        }, 5);
    });
}

function setupPainterCanvas(textureUrl) {
    paintCanvas = document.getElementById('texturePainter');
    paintCtx = paintCanvas.getContext('2d');
    gridCanvas = document.getElementById('gridOverlayCanvas');
    gridCtx = gridCanvas.getContext('2d');

    loadedBaseImage = new Image();
    loadedBaseImage.src = textureUrl;
    loadedBaseImage.onload = () => {
        scaleMultiplier = loadedBaseImage.width <= 64 ? 12 : 6;
        zoomLevel = 1.0;

        paintCanvas.width = loadedBaseImage.width;
        paintCanvas.height = loadedBaseImage.height;

        paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
        paintCtx.drawImage(loadedBaseImage, 0, 0);

        applyCanvasZoom();

        saveToUndoStack();

        if (remixThreeTexture) update3DTextureFrom2DCanvas();
        setTool('paint');
    };

    gridCanvas.onmousedown = (e) => {
        if (activeTool === 'pan') {
            isDragging = true;
            gridCanvas.style.cursor = 'grabbing';
            panStartX = e.clientX;
            panStartY = e.clientY;
            const container = document.getElementById('canvasScrollContainer');
            scrollStartX = container.scrollLeft;
            scrollStartY = container.scrollTop;
        } else {
            isPainting = true;
            saveToUndoStack();
            draw(e);
        }
    };

    gridCanvas.onmousemove = (e) => {
        if (activeTool === 'pan' && isDragging) {
            const container = document.getElementById('canvasScrollContainer');
            container.scrollLeft = scrollStartX - (e.clientX - panStartX);
            container.scrollTop = scrollStartY - (e.clientY - panStartY);
        } else if (activeTool === 'paint' && isPainting) {
            draw(e);
        }
    };

    window.addEventListener('mouseup', () => {
        isPainting = false;
        isDragging = false;
        if (activeTool === 'pan' && gridCanvas) gridCanvas.style.cursor = 'grab';
    });
}

function drawGridOverlay() {
    gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
    if (!document.getElementById('showGridToggle').checked) return;

    gridCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    gridCtx.lineWidth = 1;

    for (let x = 0; x <= gridCanvas.width; x += scaleMultiplier) {
        gridCtx.beginPath(); gridCtx.moveTo(x, 0); gridCtx.lineTo(x, gridCanvas.height); gridCtx.stroke();
    }
    for (let y = 0; y <= gridCanvas.height; y += scaleMultiplier) {
        gridCtx.beginPath(); gridCtx.moveTo(0, y); gridCtx.lineTo(gridCanvas.width, y); gridCtx.stroke();
    }
}

function toggleGridOverlay() {
    drawGridOverlay();
}

function draw(e) {
    const rect = gridCanvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * paintCanvas.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * paintCanvas.height);

    const size = parseInt(document.getElementById('brushSize').value) || 1;
    paintCtx.fillStyle = document.getElementById('paintColor').value;
    paintCtx.fillRect(x - Math.floor(size/2), y - Math.floor(size/2), size, size);

    if (updateTimer) clearTimeout(updateTimer);

    document.getElementById('paintStatus').style.opacity = "1";
    document.getElementById('paintStatus').innerText = "Drawing...";

    updateTimer = setTimeout(() => {
        update3DTextureFrom2DCanvas();
        document.getElementById('paintStatus').innerText = "Saved to 3D View!";
        setTimeout(() => { document.getElementById('paintStatus').style.opacity = "0"; }, 1000);
    }, 300);
}

function saveToUndoStack() {
    if (undoStack.length >= MAX_UNDO_STEPS) {
        undoStack.shift();
    }
    undoStack.push(paintCanvas.toDataURL());
}

function undoPaint() {
    if (undoStack.length <= 1) return;

    undoStack.pop();
    const previousStateURL = undoStack[undoStack.length - 1];

    const img = new Image();
    img.src = previousStateURL;
    img.onload = () => {

        if (loadedBaseImage) {
            paintCanvas.width = loadedBaseImage.width;
            paintCanvas.height = loadedBaseImage.height;
        }

        paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
        paintCtx.drawImage(img, 0, 0);

        update3DTextureFrom2DCanvas();
    };
}

function clearToBaseTexture() {
    if (!loadedBaseImage) return;
    saveToUndoStack();
    paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    paintCtx.drawImage(loadedBaseImage, 0, 0);
    update3DTextureFrom2DCanvas();
}

function update3DTextureFrom2DCanvas() {
    if (!remixThreeTexture || !paintCanvas) return;

    const imgData = paintCanvas.toDataURL();
    const loader = new THREE.TextureLoader();
    loader.load(imgData, (newTexture) => {
        newTexture.flipY = false;
        if (THREE.sRGBEncoding) newTexture.encoding = THREE.sRGBEncoding;
        newTexture.magFilter = THREE.NearestFilter;
        newTexture.minFilter = THREE.NearestFilter;

        remixThreeTexture = newTexture;
        if(remixMeshInstance) {
            remixMeshInstance.traverse((child) => {
                if (child.isMesh) {
                    child.material.map = remixThreeTexture;
                    child.material.needsUpdate = true;
                }
            });
        }
    });
}

function setupRemixCanvas() {
    const container = document.getElementById('remixCanvasContainer');
    container.innerHTML = '';

    remixScene = new THREE.Scene();
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    remixScene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(5, 10, 7.5);
    remixScene.add(dirLight);

    remixCamera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    remixCamera.position.set(0, 0.2, 3.2);

    remixRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    remixRenderer.setSize(container.clientWidth, container.clientHeight);
    if (THREE.sRGBEncoding) remixRenderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(remixRenderer.domElement);

    const loader = new THREE.GLTFLoader();
    loader.load(activeRemixModel.glb, (gltf) => {
        remixMeshInstance = gltf.scene;
        if (activeRemixModel.rotateX) remixMeshInstance.rotation.x = -Math.PI / 2;
        remixMeshInstance.rotation.y = activeRemixModel.rotationOffsetY || 0;

        new THREE.TextureLoader().load(activeRemixModel.texture, (texture) => {
            texture.flipY = false;
            if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            remixThreeTexture = texture;

            remixMeshInstance.traverse((child) => {
                if (child.isMesh) {
                    child.material.newMesh = new THREE.MeshBasicMaterial({
                        map: remixThreeTexture,
                        transparent: true,
                        alphaTest: 0.5,
                        side: THREE.DoubleSide
                    });
                    child.material = child.material.newMesh;
                }
            });
            update3DTextureFrom2DCanvas();
        });

        const box = new THREE.Box3().setFromObject(remixMeshInstance);
        const center = box.getCenter(new THREE.Vector3());
        remixMeshInstance.position.sub(center);
        remixScene.add(remixMeshInstance);
    });

    function run() {
        if(document.getElementById('remixModal').style.display === 'none') return;
        requestAnimationFrame(run);
        if (remixMeshInstance) {
            if (activeRemixModel.rotateX) remixMeshInstance.rotation.z += 0.003;
            else remixMeshInstance.rotation.y += 0.003;
        }
        remixRenderer.render(remixScene, remixCamera);
    }
    run();
}

function handleRemixTextureChange(e) {
    const file = e.target.files[0];
    if(!file) return;

    const blobURL = URL.createObjectURL(file);
    setupPainterCanvas(blobURL);
}

async function submitRemix() {
    const title = document.getElementById('remixAssetTitle').value;
    if(!title) return alert("Add a title for your custom skin!");

    paintCanvas.toBlob(async (blob) => {
        const formData = new FormData();
        formData.append('title', title);
        formData.append('asset_type', 'skin_only');
        formData.append('associated_model', activeRemixModel.identifier);
        formData.append('texture', blob, `${title.toLowerCase().replace(/\s+/g, '_')}.png`);

        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.error) alert(data.error);
        else { toggleRemixModal(false); loadAssets(); }
    }, 'image/png');
}

async function deleteAsset(id) {
    if (!confirm('Are you sure you want to delete this asset?')) return;
    await fetch(`/api/assets/${id}`, { method: 'DELETE' });
    loadAssets();
}

function toggleRemixModal(show) {
    document.getElementById('remixModal').style.display = show ? 'block' : 'none';
    document.getElementById('remixOverlay').style.display = show ? 'block' : 'none';
    if(!show && updateTimer) clearTimeout(updateTimer);
}

window.onload = () => {
    loadAssets();
    document.getElementById('sortSelector').addEventListener('change', loadAssets);
};
