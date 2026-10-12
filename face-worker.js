// MediaPipe's WASM loader uses importScripts, so this must be a classic worker.
let faceFeatures;
let model = null;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      ({ faceFeatures } = await import('./focus.js'));
      const { FaceLandmarker, FilesetResolver } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs');
      const files = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm');
      model = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 2, minFaceDetectionConfidence: .65,
        minFacePresenceConfidence: .65, minTrackingConfidence: .65
      });
      self.postMessage({ type: 'ready' });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
  }
  if (data.type === 'frame') {
    try {
      const result = model.detectForVideo(data.frame, data.timestamp);
      const faces = result.faceLandmarks;
      self.postMessage({ type: 'result', feature: faces.length === 1 ? faceFeatures(faces[0]) : null,
        faceCount: faces.length });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
    finally { data.frame.close(); }
  }
};
