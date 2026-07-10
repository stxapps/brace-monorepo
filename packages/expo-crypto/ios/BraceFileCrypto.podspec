require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'BraceFileCrypto'
  s.version        = package['version']
  s.summary        = 'Native file-level AES-256-GCM for brace (frozen v1 blob frame)'
  s.description    = 'Encrypts/decrypts whole files path-to-path in the native layer so file bytes never enter the JS heap.'
  s.author         = 'stxapps'
  s.homepage       = 'https://brace.to'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
end
