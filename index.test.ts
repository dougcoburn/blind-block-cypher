import { describe, it, expect } from 'vitest'; 
import * as mod from './index';

describe('index', () => {
    it('adds', () => {
        expect(mod.add(1, 3)).toBe(4);
    });

    it('subtracts', () => {
        expect(mod.subtract(3, 1)).toBe(2);
    })
});
