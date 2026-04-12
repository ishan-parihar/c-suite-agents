/// <reference types="vitest/globals" />

import { describe, it, expect } from 'vitest';

describe('WebSocket API Route (Phase 1.2)', () => {
  it('should have WS route file exist', () => {
    const fs = require('fs');
    const path = require('path');
    const routePath = path.join(__dirname, '../../app/api/ws/route.ts');
    expect(fs.existsSync(routePath)).toBe(true);
  });

  it('should allow WS path in middleware', () => {
    const fs = require('fs');
    const path = require('path');
    const middlewarePath = path.join(__dirname, '../../middleware.ts');
    const content = fs.readFileSync(middlewarePath, 'utf-8');
    expect(content).toContain('/api/ws');
  });
});
