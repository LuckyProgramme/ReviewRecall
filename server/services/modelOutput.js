const MAX_APPLICATION_OUTPUT_ATTEMPTS = 2;

function invalidModelOutput(cause) {
  return Object.assign(new Error("Gemini output failed application validation", { cause }), {
    code: "MODEL_OUTPUT_INVALID",
    retryable: false,
  });
}

async function generateValidated(produce, validate, attempts = MAX_APPLICATION_OUTPUT_ATTEMPTS) {
  let validationError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const raw = await produce();
    try {
      return await validate(raw);
    } catch (error) {
      validationError = error;
    }
  }
  throw invalidModelOutput(validationError);
}

module.exports = { MAX_APPLICATION_OUTPUT_ATTEMPTS, generateValidated, invalidModelOutput };
