import { generateNoGuess } from "./generator.js";

self.onmessage = ({ data }) => {
  try {
    const { round } = generateNoGuess(data.config, data.first);
    self.postMessage({ ok: true, round });
  } catch (error) {
    self.postMessage({ ok: false, message: error.message });
  }
};
