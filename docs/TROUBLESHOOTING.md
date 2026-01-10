# Troubleshooting Guide

This guide helps you diagnose and fix common issues with the Homebridge Daikin Cloud plugin.

## Table of Contents

- [Authentication Issues](#authentication-issues)
- [Device Not Appearing](#device-not-appearing)
- [Connection Problems](#connection-problems)
- [WebSocket Issues](#websocket-issues)
- [Rate Limiting](#rate-limiting)
- [Performance Issues](#performance-issues)
- [Configuration Errors](#configuration-errors)

---

## Authentication Issues

### Symptoms
- "Not authenticated" errors in logs
- Token expired messages
- Unable to see devices in Homebridge

### Solutions

#### Developer Portal Mode

1. **Check Credentials**
   ```bash
   # Verify your credentials are correct
   # Go to: https://developer.cloud.daikineurope.com/
   ```

2. **Verify Callback Server**
   - Check firewall allows incoming connections on configured port (default: 8582)
   - Ensure `callbackServerExternalAddress` is your external IP, not localhost
   - Verify port forwarding is configured on your router

3. **Token File Location**
   ```bash
   # Check if token file exists
   ls -la ~/.homebridge/.daikin-controller-cloud-tokenset

   # Check permissions (should be -rw------- / 600)
   # If wrong, the plugin will fix it automatically on next save
   ```

4. **Re-authenticate**
   - Go to Homebridge UI > Daikin Cloud plugin > Custom UI tab
   - Click "Authenticate"
   - Follow the OAuth flow
   - Restart Homebridge

#### Mobile App Mode

1. **Verify Credentials**
   - Use the same email/password as Daikin Onecta mobile app
   - Try logging into the mobile app first to confirm credentials work

2. **Token File Location**
   ```bash
   # Check if mobile token file exists
   ls -la ~/.homebridge/.daikin-mobile-tokenset
   ```

3. **Re-authenticate**
   - Go to Homebridge UI > Daikin Cloud plugin > Custom UI tab
   - Click "Test & Save Credentials"
   - Restart Homebridge

### Common Errors

**Error: `invalid_grant`**
- **Cause**: Token expired or credentials changed
- **Solution**: Delete token file and re-authenticate
  ```bash
  rm ~/.homebridge/.daikin-controller-cloud-tokenset
  # or for mobile:
  rm ~/.homebridge/.daikin-mobile-tokenset
  ```

**Error: `Callback address cannot be localhost`**
- **Cause**: Using localhost/127.0.0.1 for callback server
- **Solution**: Use your external IP or domain name

---

## Device Not Appearing

### Diagnostic Steps

1. **Check Device in Daikin App**
   - Verify device appears in Daikin Onecta mobile app
   - Ensure device is online and connected to Wi-Fi

2. **Check Homebridge Logs**
   ```bash
   # Enable debug mode in Homebridge settings
   # Look for device discovery logs
   grep "Daikin" ~/.homebridge/homebridge.log
   ```

3. **Check Device UUID**
   - Each device gets a unique UUID based on device ID
   - If UUID conflicts with another accessory, it won't appear

4. **Verify Device Not Excluded**
   - Check `config.json` for `excludedDevicesByDeviceId`
   - Device ID might be in exclusion list

### Solutions

**Device Shows in Logs But Not in HomeKit**
```bash
# Clear HomeKit cache
# WARNING: This will remove ALL accessories from HomeKit
rm -rf ~/.homebridge/accessories/cachedAccessories

# Restart Homebridge
sudo systemctl restart homebridge
```

**Device Model Not Supported**
- Check logs for "Failed to create accessory" errors
- File an issue on GitHub with device model info

**Device Excluded Accidentally**
1. Go to Homebridge UI > Daikin Cloud plugin > Settings tab
2. Check "Device Visibility" section
3. Toggle device back on
4. Restart Homebridge

---

## Connection Problems

### Network Connectivity

**Symptoms**: "Failed to get cloud devices", "ECONNREFUSED", "ETIMEDOUT"

**Solutions**:

1. **Check Internet Connection**
   ```bash
   # Test connectivity to Daikin API
   ping api.onecta.daikineurope.com

   # Test HTTPS connectivity
   curl -I https://api.onecta.daikineurope.com
   ```

2. **Check Firewall**
   - Ensure outbound HTTPS (443) is allowed
   - For WebSocket: Ensure wss:// connections allowed

3. **Proxy Configuration**
   - If behind corporate proxy, set environment variables:
   ```bash
   export HTTP_PROXY=http://proxy:8080
   export HTTPS_PROXY=http://proxy:8080
   ```

### DNS Issues

**Error**: "getaddrinfo ENOTFOUND"

**Solution**:
```bash
# Check DNS resolution
nslookup api.onecta.daikineurope.com

# Try using different DNS (e.g., Google DNS)
# Edit /etc/resolv.conf:
nameserver 8.8.8.8
nameserver 8.8.4.4
```

---

## WebSocket Issues

### Symptoms
- Real-time updates not working
- Must manually refresh to see changes
- "WebSocket connection failed" in logs

### Diagnostic Steps

```bash
# Check WebSocket setting in config
cat ~/.homebridge/config.json | grep enableWebSocket

# Check logs for WebSocket errors
grep -i "websocket" ~/.homebridge/homebridge.log
```

### Solutions

**WebSocket Not Connecting**

1. **Enable WebSocket** (only works with Mobile App auth mode)
   ```json
   {
     "authMode": "mobile_app",
     "enableWebSocket": true
   }
   ```

2. **Check Firewall**
   - Ensure outbound WSS connections allowed
   - Port: 443 (wss://)

3. **Verify Mobile App Mode**
   - WebSocket only available with mobile app authentication
   - Developer Portal mode doesn't support WebSocket

**WebSocket Keeps Disconnecting**

- This is normal - plugin will automatically reconnect
- Check for network stability issues
- Reduce update interval to compensate

**Disable WebSocket**
```json
{
  "enableWebSocket": false
}
```

---

## Rate Limiting

### Understanding Rate Limits

| Auth Mode | Rate Limit | Recommended Interval |
|-----------|------------|---------------------|
| Developer Portal | 200 calls/day | 15+ minutes |
| Mobile App | 5000 calls/day | 1-5 minutes |

### Symptoms
- "Rate limit exceeded" errors
- 429 HTTP status codes
- Devices stop updating

### Check Current Usage

Go to Homebridge UI > Daikin Cloud plugin > Authentication tab to see:
- Remaining calls today
- Rate limit details

### Solutions

**Reduce Update Frequency**
```json
{
  "updateIntervalInMinutes": 30,  // Increase this value
  "forceUpdateDelay": 120000      // 120 seconds (in milliseconds)
}
```

**Switch to Mobile App Mode**
- 25x higher rate limit (5000 vs 200 calls/day)
- Enables WebSocket for real-time updates
- Reduces polling needs

**Enable WebSocket** (Mobile App mode only)
```json
{
  "authMode": "mobile_app",
  "enableWebSocket": true,
  "updateIntervalInMinutes": 60  // Can be higher with WebSocket
}
```

---

## Performance Issues

### Slow Response Times

**Check Update Interval**
```json
{
  "updateIntervalInMinutes": 5,  // Faster updates = more API calls
  "forceUpdateDelay": 10000      // 10 seconds
}
```

**Recommendations**:
- Developer Portal: 15-30 minutes
- Mobile App (no WebSocket): 5-15 minutes
- Mobile App (with WebSocket): 30-60 minutes (WebSocket handles real-time updates)

### High Memory Usage

1. **Check Number of Devices**
   - Each device creates multiple HomeKit services
   - 10+ devices can use significant memory

2. **Exclude Unused Devices**
   - Go to Settings tab > Device Visibility
   - Disable devices you don't need

3. **Disable Unused Features**
   ```json
   {
     "showPowerfulMode": false,
     "showEconoMode": false,
     "showStreamerMode": false
   }
   ```

### Homebridge Hanging

```bash
# Check for event loop blocking
# Enable debug mode and check logs for long operations

# Restart Homebridge
sudo systemctl restart homebridge
```

---

## Configuration Errors

### Validation Errors

The plugin now validates configuration at runtime. Check logs for:

**Port Errors**
```
Invalid port number: 99999. Must be between 1 and 65535.
```
**Solution**: Use valid port (default: 8582)

**Update Interval Errors**
```
Update interval must be between 1 and 60 minutes, got: 120
```
**Solution**: Use value between 1-60 minutes

**Localhost Warning**
```
Callback address cannot be localhost. Use your external IP or domain.
```
**Solution**: Configure external IP address

### Config Schema Migration

**Old Config Format** (deprecated):
```json
{
  "showExtraFeatures": true
}
```

**New Config Format**:
```json
{
  "showPowerfulMode": true,
  "showEconoMode": true,
  "showStreamerMode": true,
  "showOutdoorSilentMode": true,
  "showIndoorSilentMode": true
}
```

---

## Getting Help

### Enable Debug Mode

1. Go to Homebridge Settings
2. Enable "Debug Mode"
3. Restart Homebridge
4. Check logs in Homebridge UI

### Collect Diagnostic Information

```bash
# System info
uname -a
node --version
npm --version

# Homebridge info
hb-service status
cat ~/.homebridge/config.json | grep -A 20 "DaikinCloud"

# Recent logs (last 100 lines)
tail -100 ~/.homebridge/homebridge.log

# Check token files
ls -la ~/.homebridge/.daikin-*
```

### Report an Issue

When reporting issues on GitHub, please include:

1. **Plugin Version**: Check in Homebridge UI
2. **Node.js Version**: `node --version`
3. **Auth Mode**: Developer Portal or Mobile App
4. **Error Messages**: Full error from logs
5. **Device Model**: From Daikin app
6. **Config** (sanitized): Remove credentials!

**Example Issue Report**:
```
**Environment**
- Plugin Version: 1.2.5
- Node.js: v20.19.6
- Homebridge: v1.8.0
- Auth Mode: mobile_app

**Problem**
Device not appearing in HomeKit after authentication.

**Logs**
[paste relevant log lines here]

**Config** (credentials removed)
[paste sanitized config here]
```

---

## Quick Reference

### Reset Everything

```bash
# 1. Remove token files
rm ~/.homebridge/.daikin-*

# 2. Clear cached accessories
rm -rf ~/.homebridge/accessories/cachedAccessories

# 3. Restart Homebridge
sudo systemctl restart homebridge

# 4. Re-authenticate in UI
```

### Check Plugin Health

```bash
# Check if plugin is loaded
hb-service logs | grep "Daikin"

# Check for errors
hb-service logs | grep -i "error"

# Check authentication status
cat ~/.homebridge/.daikin-controller-cloud-tokenset | jq .expires_at
```

### Test API Connectivity

```bash
# Test with curl (replace TOKEN with actual token)
curl -H "Authorization: Bearer TOKEN" \
  https://api.onecta.daikineurope.com/v1/gateway-devices
```

---

## Additional Resources

- [GitHub Repository](https://github.com/mp-consulting/homebridge-daikin-cloud)
- [Homebridge Documentation](https://github.com/homebridge/homebridge/wiki)
- [Daikin Developer Portal](https://developer.cloud.daikineurope.com/)
