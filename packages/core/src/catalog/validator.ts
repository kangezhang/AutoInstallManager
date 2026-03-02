import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ToolDefinitionSchema, type ToolDefinition } from '@aim/shared';
import { z } from 'zod';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  file: string;
  message: string;
  path?: string;
}

/**
 * Catalog validator
 */
export class CatalogValidator {
  /**
   * Validate a single tool definition file
   */
  async validateFile(filePath: string): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    try {
      // Read file
      const content = await fs.readFile(filePath, 'utf-8');

      // Parse YAML
      let data: unknown;
      try {
        data = yaml.load(content);
      } catch (err) {
        errors.push({
          file: filePath,
          message: `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
        });
        return { valid: false, errors };
      }

      // Validate against schema
      try {
        ToolDefinitionSchema.parse(data);
      } catch (err) {
        if (err instanceof z.ZodError) {
          for (const issue of err.issues) {
            errors.push({
              file: filePath,
              message: issue.message,
              path: issue.path.join('.'),
            });
          }
        } else {
          errors.push({
            file: filePath,
            message: `Validation error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return { valid: false, errors };
      }

      return { valid: true, errors: [] };
    } catch (err) {
      errors.push({
        file: filePath,
        message: `File read error: ${err instanceof Error ? err.message : String(err)}`,
      });
      return { valid: false, errors };
    }
  }

  /**
   * Validate all tool definition files in a directory
   */
  async validateDirectory(dirPath: string): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const yamlFiles = entries
        .filter((entry) => entry.isFile() && /\.(yaml|yml)$/i.test(entry.name))
        .map((entry) => path.join(dirPath, entry.name));

      if (yamlFiles.length === 0) {
        errors.push({
          file: dirPath,
          message: 'No YAML files found in directory',
        });
        return { valid: false, errors };
      }

      // Validate each file
      const results = await Promise.all(
        yamlFiles.map((file) => this.validateFile(file))
      );

      // Collect all errors
      for (const result of results) {
        errors.push(...result.errors);
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    } catch (err) {
      errors.push({
        file: dirPath,
        message: `Directory read error: ${err instanceof Error ? err.message : String(err)}`,
      });
      return { valid: false, errors };
    }
  }

  /**
   * Load and parse a tool definition file
   */
  async loadToolDefinition(filePath: string): Promise<ToolDefinition> {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = yaml.load(content);
    return ToolDefinitionSchema.parse(data);
  }

  /**
   * Load all tool definitions from a directory
   */
  async loadToolDefinitions(dirPath: string): Promise<ToolDefinition[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const yamlFiles = entries
      .filter((entry) => entry.isFile() && /\.(yaml|yml)$/i.test(entry.name))
      .map((entry) => path.join(dirPath, entry.name));

    const definitions = await Promise.all(
      yamlFiles.map((file) => this.loadToolDefinition(file))
    );

    return definitions;
  }
}

