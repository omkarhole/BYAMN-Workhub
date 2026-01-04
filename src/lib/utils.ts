export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }
  
  // Check if the entire input is a malicious protocol
  if (/^(javascript|vbscript):/i.test(input.trim())) {
    return '';
  }
  
  // Remove script tags (case insensitive)
  let result = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove javascript: and vbscript: protocols (case insensitive)
  result = result.replace(/javascript:/gi, '');
  result = result.replace(/vbscript:/gi, '');
  
  // Remove event handlers (case insensitive)
  result = result.replace(/on\w+\s*=\s*["']?[^"'\s>]*["']?/gi, '');
  
  // Remove all HTML tags
  result = result.replace(/<[^>]*>/g, '');
  
  return result.trim();
}

export function isValidUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    // Only allow http and https protocols
    return ['http:', 'https:'].includes(parsedUrl.protocol);
  } catch {
    return false;
  }
}

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidPassword(password: string): boolean {
  // Password must be at least 6 characters long and contain at least one letter and one number
  const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{6,}$/;
  return passwordRegex.test(password);
}

export function isValidName(name: string): boolean {
  // Names should only contain letters, spaces, hyphens, and apostrophes
  const nameRegex = /^[a-zA-Z\s\-']+$/;
  return nameRegex.test(name) && name.trim().length >= 2 && name.trim().length <= 50;
}

import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}