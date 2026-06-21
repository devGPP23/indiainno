import api from '../utils/api';

const SARVAM_API_KEY = import.meta.env.VITE_SARVAM_API_KEY || 'sk_94vvqhgo_opzIH8VOZKtoPs894jfnFGAZ';

let mediaRecorder = null;
let audioChunks = [];

export async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };

    mediaRecorder.start(100);
    return { success: true, message: 'Recording started' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

export async function stopRecording() {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      resolve({ success: false, audio: null, message: 'Not recording' });
      return;
    }

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      
      // Stop all tracks
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
      
      resolve({ success: true, audio: audioBlob, message: 'Recording stopped' });
    };

    mediaRecorder.stop();
  });
}

export async function transcribeWithSarvam(audioBlob) {
  try {
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('model', 'saaras:v3');
    formData.append('language_code', 'en-IN');

    const response = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: {
        'api-subscription-key': SARVAM_API_KEY
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error('Transcription failed');
    }

    const data = await response.json();
    return { success: true, text: data.text || data.transcript || '' };
  } catch (err) {
    console.error('Sarvam transcription error:', err);
    return { success: false, text: '', error: err.message };
  }
}

export async function interpretCommandWithGroq(transcribedText) {
  try {
    // Use backend proxy for Groq to avoid exposing API key
    const response = await api.post('/ai/interpret-command', {
      command: transcribedText,
      currentUrl: window.location.href
    });
    
    return response.data;
  } catch (err) {
    console.error('Groq interpretation error:', err);
    // Fallback: simple keyword matching
    const text = transcribedText.toLowerCase();
    
    if (text.includes('go to') || text.includes('navigate') || text.includes('open')) {
      const pageMatch = text.match(/(?:go to|navigate|open)\s+(.+)/);
      return { action: 'NAVIGATE', target: pageMatch?.[1] || text, confidence: 0.7 };
    }
    if (text.includes('click') || text.includes('press') || text.includes('tap')) {
      const btnMatch = text.match(/(?:click|press|tap)\s+(.+)/);
      return { action: 'CLICK_BUTTON', target: btnMatch?.[1] || text, confidence: 0.6 };
    }
    if (text.includes('scroll down')) {
      return { action: 'SCROLL_DOWN', target: '', confidence: 0.9 };
    }
    if (text.includes('scroll up')) {
      return { action: 'SCROLL_UP', target: '', confidence: 0.9 };
    }
    if (text.includes('submit') || text.includes('send')) {
      return { action: 'SUBMIT_FORM', target: 'submit', confidence: 0.7 };
    }
    
    return { action: 'UNKNOWN', target: '', confidence: 0 };
  }
}

export async function executeCommand(command) {
  const { action, target, value, confidence } = command;
  
  if (confidence < 0.5) {
    return { success: false, message: 'Low confidence, could not understand command' };
  }

  try {
    switch (action) {
      case 'NAVIGATE':
        // Navigate to page
        const link = findLinkByText(target);
        if (link) {
          link.click();
          return { success: true, message: `Navigated to ${target}` };
        }
        return { success: false, message: `Could not find link: ${target}` };

      case 'CLICK_BUTTON':
        // Find and click button
        const button = findButtonByText(target);
        if (button) {
          button.click();
          return { success: true, message: `Clicked ${target}` };
        }
        return { success: false, message: `Could not find button: ${target}` };

      case 'FILL_INPUT':
        // Fill input field
        const input = findInputByLabel(target);
        if (input) {
          input.value = value || target;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, message: `Filled ${target} with ${value || target}` };
        }
        return { success: false, message: `Could not find input: ${target}` };

      case 'SCROLL_UP':
        window.scrollBy({ top: -300, behavior: 'smooth' });
        return { success: true, message: 'Scrolled up' };

      case 'SCROLL_DOWN':
        window.scrollBy({ top: 300, behavior: 'smooth' });
        return { success: true, message: 'Scrolled down' };

      case 'SUBMIT_FORM':
        const submitBtn = findButtonByText('submit');
        if (submitBtn) {
          submitBtn.click();
          return { success: true, message: 'Form submitted' };
        }
        return { success: false, message: 'Could not find submit button' };

      default:
        return { success: false, message: `Unknown action: ${action}` };
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function findLinkByText(text) {
  const links = document.querySelectorAll('a');
  for (const link of links) {
    if (link.textContent.toLowerCase().includes(text.toLowerCase())) {
      return link;
    }
  }
  return null;
}

function findButtonByText(text) {
  const buttons = document.querySelectorAll('button, input[type="submit"], [role="button"]');
  for (const btn of buttons) {
    const btnText = btn.textContent?.toLowerCase() || btn.value?.toLowerCase() || '';
    if (btnText.includes(text.toLowerCase()) || text.toLowerCase().includes(btnText)) {
      return btn;
    }
  }
  return null;
}

function findInputByLabel(labelText) {
  const labels = document.querySelectorAll('label, [for]');
  for (const label of labels) {
    if (label.textContent.toLowerCase().includes(labelText.toLowerCase())) {
      const inputId = label.getAttribute('for');
      if (inputId) {
        const input = document.getElementById(inputId);
        if (input) return input;
      }
      const input = label.querySelector('input, textarea, select');
      if (input) return input;
    }
  }
  
  // Fallback: search by placeholder
  const inputs = document.querySelectorAll('input, textarea');
  for (const input of inputs) {
    if (input.placeholder?.toLowerCase().includes(labelText.toLowerCase())) {
      return input;
    }
  }
  return null;
}

export async function processVoiceCommand() {
  // 1. Start recording
  const startResult = await startRecording();
  if (!startResult.success) {
    return { success: false, message: 'Could not start recording: ' + startResult.message };
  }

  // Wait for user to speak (3 seconds)
  await new Promise(r => setTimeout(r, 3000));

  // 2. Stop recording
  const stopResult = await stopRecording();
  if (!stopResult.success || !stopResult.audio) {
    return { success: false, message: 'Could not stop recording' };
  }

  // 3. Transcribe with Sarvam
  const transcriptResult = await transcribeWithSarvam(stopResult.audio);
  if (!transcriptResult.success) {
    return { success: false, message: 'Transcription failed: ' + transcriptResult.error };
  }

  const transcribedText = transcriptResult.text;
  if (!transcribedText) {
    return { success: false, message: 'No speech detected' };
  }

  // 4. Interpret with Groq
  const command = await interpretCommandWithGroq(transcribedText);
  
  // 5. Execute command
  const execResult = await executeCommand(command);

  return {
    success: execResult.success,
    transcribedText,
    command,
    execution: execResult,
    message: execResult.message || `Understood: "${transcribedText}". ${execResult.message}`
  };
}
