import { Request, Response, NextFunction } from 'express';

export interface ValidationRule {
  field: string;
  required?: boolean;
  type?: 'string' | 'number' | 'array' | 'object';
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  customValidator?: (value: any) => boolean | string;
}

export function validateInput(rules: ValidationRule[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    for (const rule of rules) {
      const value = req.body[rule.field] || req.query[rule.field] || req.params[rule.field];

      // Check required fields
      if (rule.required && (value === undefined || value === null || value === '')) {
        return res.status(400).json({ error: `Missing required field: ${rule.field}` });
      }

      // Skip further validation if value is undefined/null and not required
      if ((value === undefined || value === null) && !rule.required) {
        continue;
      }

      // Type validation
      if (rule.type) {
        switch (rule.type) {
          case 'string':
            if (typeof value !== 'string') {
              return res.status(400).json({ error: `Field ${rule.field} must be a string` });
            }
            if (rule.minLength !== undefined && value.length < rule.minLength) {
              return res.status(400).json({ error: `Field ${rule.field} must be at least ${rule.minLength} characters` });
            }
            if (rule.maxLength !== undefined && value.length > rule.maxLength) {
              return res.status(400).json({ error: `Field ${rule.field} must not exceed ${rule.maxLength} characters` });
            }
            break;
          case 'number':
            if (typeof value !== 'number' || isNaN(value)) {
              return res.status(400).json({ error: `Field ${rule.field} must be a number` });
            }
            if (rule.min !== undefined && value < rule.min) {
              return res.status(400).json({ error: `Field ${rule.field} must be at least ${rule.min}` });
            }
            if (rule.max !== undefined && value > rule.max) {
              return res.status(400).json({ error: `Field ${rule.field} must not exceed ${rule.max}` });
            }
            break;
          case 'array':
            if (!Array.isArray(value)) {
              return res.status(400).json({ error: `Field ${rule.field} must be an array` });
            }
            break;
          case 'object':
            if (typeof value !== 'object' || value === null || Array.isArray(value)) {
              return res.status(400).json({ error: `Field ${rule.field} must be an object` });
            }
            break;
        }
      }

      // Custom validation
      if (rule.customValidator) {
        const result = rule.customValidator(value);
        if (result !== true) {
          const errorMessage = typeof result === 'string' ? result : `Validation failed for field ${rule.field}`;
          return res.status(400).json({ error: errorMessage });
        }
      }
    }

    next();
  };
}

// Specific validation for sale creation
export const validateSaleInput = validateInput([
  {
    field: 'items',
    required: true,
    type: 'array',
    customValidator: (items) => {
      if (!Array.isArray(items) || items.length === 0) {
        return 'Cart items required';
      }
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || typeof item !== 'object') {
          return `Item at index ${i} must be an object`;
        }
        if (item.quantity === undefined || item.quantity === null || isNaN(item.quantity) || item.quantity < 0) {
          return `Item at index ${i}: quantity must be a non-negative number`;
        }
        if (item.unit_price === undefined || item.unit_price === null || isNaN(item.unit_price) || item.unit_price < 0) {
          return `Item at index ${i}: unit_price must be a non-negative number`;
        }
        if (item.inventory_id === undefined || item.inventory_id === null || isNaN(item.inventory_id)) {
          return `Item at index ${i}: inventory_id is required`;
        }
      }
      return true;
    }
  },
  {
    field: 'patient_id',
    type: 'number'
  },
  {
    field: 'doctor_id',
    type: 'number'
  },
  {
    field: 'discount',
    type: 'number',
    min: 0
  }
]);