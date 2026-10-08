function runCode(scriptText) {
  try {
    const codeFunction = new Function(scriptText);
    try {
      return { success: true, result: codeFunction(), code: scriptText };
    } catch (error) {
      return {
        success: false,
        error: "Execution error: " + (error.message || String(error)),
        errorType: error.name || "Error",
        lineNumber: error.lineNumber,
        stack: error.stack,
        code: scriptText,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: "Parse error: " + (error.message || String(error)),
      errorType: error.name || "SyntaxError",
      stack: error.stack,
      code: scriptText,
    };
  }
}
