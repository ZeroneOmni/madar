param([string]$QueryFile)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class MadarSidebarPointer {
    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int X; public int Y; }

    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);

    static Point ScreenPoint(long handle, double x, double y, double zoom) {
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        var hwnd = new IntPtr(handle);
        var point = new Point();
        ClientToScreen(hwnd, ref point);
        double scale = GetDpiForWindow(hwnd) / 96.0 * zoom;
        point.X += (int)Math.Round(x * scale);
        point.Y += (int)Math.Round(y * scale);
        return point;
    }

    public static int Hit(long handle, double x, double y, double zoom) {
        var point = ScreenPoint(handle, x, y, zoom);
        return SendMessage(new IntPtr(handle), 0x84, IntPtr.Zero,
            new IntPtr((point.Y << 16) | (point.X & 0xffff))).ToInt32();
    }

    public static void Move(long handle, double x, double y, double zoom) {
        var point = ScreenPoint(handle, x, y, zoom);
        SetCursorPos(point.X, point.Y);
    }

    public static void Click(long handle, double x, double y, double zoom) {
        Move(handle, x, y, zoom);
        mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
        mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
    }
}
'@

$query = Get-Content -LiteralPath $QueryFile -Raw | ConvertFrom-Json
if ($query.click) {
    $point = $query.points[0]
    [MadarSidebarPointer]::Click([long]$query.handle, $point.x, $point.y, $query.zoom)
} else {
    $hits = @($query.points | ForEach-Object {
        [MadarSidebarPointer]::Hit([long]$query.handle, $_.x, $_.y, $query.zoom)
    })
    $point = $query.points[0]
    [MadarSidebarPointer]::Move([long]$query.handle, $point.x, $point.y, $query.zoom)
    ConvertTo-Json -InputObject $hits -Compress
}
