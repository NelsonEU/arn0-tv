using System;
using System.IO;
using System.Runtime.InteropServices;

internal static class Query
{
    private const string TargetApp = "Arn0Lnchr0.Launcher";
    private static readonly string[] Keys = {
        "db/appfw/home_appid",
        "db/appfw/startup_appid",
        "db/appfw/booting_appid_backup",
        "db/first_screen/type"
    };
    private const string AutoKey = "db/menu/smart_hub/ontvsetting/auto_start";

    [DllImport("libbundle.so.0")] private static extern IntPtr bundle_create();
    [DllImport("libbundle.so.0")] private static extern void bundle_free(IntPtr bundle);
    [DllImport("libaul.so.0")] private static extern int aul_svc_set_operation(IntPtr bundle, string operation);
    [DllImport("libaul.so.0")] private static extern int aul_get_default_app(IntPtr bundle, out IntPtr app);
    [DllImport("libapp-context-manager-common.so")] private static extern byte util_is_appbooting_supported_webapp_byappid(string appId);
    [DllImport("libvconf.so.0")] private static extern IntPtr vconf_get_str(string key);
    [DllImport("libvconf.so.0")] private static extern int vconf_get_int(string key, out int value);
    [DllImport("libc")] private static extern uint getuid();
    [DllImport("libc")] private static extern void free(IntPtr ptr);

    private static string ReadVconf(string key)
    {
        IntPtr value = vconf_get_str(key);
        if (value == IntPtr.Zero) throw new Exception("Unable to read string key: " + key);
        try { return Marshal.PtrToStringAnsi(value); }
        finally { free(value); }
    }

    private static string ReadHomeOperation()
    {
        IntPtr bundle = bundle_create();
        if (bundle == IntPtr.Zero) throw new Exception("bundle_create failed");
        try
        {
            const string operation = "http://tizen.org/appcontrol/operation/main";
            if (aul_svc_set_operation(bundle, operation) != 0) throw new Exception("Unable to query main operation");
            IntPtr app;
            if (aul_get_default_app(bundle, out app) != 0 || app == IntPtr.Zero) throw new Exception("Unable to read default main app");
            try { return Marshal.PtrToStringAnsi(app); }
            finally { free(app); }
        }
        finally { bundle_free(bundle); }
    }

    public static int Main()
    {
        try
        {
            if (IntPtr.Size != 4) throw new Exception("Expected 32-bit process; stopped");
            uint uid = getuid();
            if (uid != 901) throw new Exception("Expected SDK UID 901, got " + uid + "; stopped");
            string prd = File.ReadAllText("/etc/prd_info.ini");
            if (prd.IndexOf("T-PTMDEUC-1720.7", StringComparison.Ordinal) < 0 &&
                prd.IndexOf("Version=T-NKLBUABC-1720.7;", StringComparison.Ordinal) < 0)
                throw new Exception("Firmware guard did not match a documented build; stopped");
            Console.WriteLine("QUERY_BEGIN");
            Console.WriteLine("uid=" + uid);
            Console.WriteLine("architecture_bits=" + (IntPtr.Size * 8));
            Console.WriteLine("firmware_guard=matched");
            Console.WriteLine("home_operation=" + ReadHomeOperation());
            foreach (string key in Keys) Console.WriteLine(key + "=" + ReadVconf(key));
            int auto;
            if (vconf_get_int(AutoKey, out auto) != 0) throw new Exception("Unable to read integer key: " + AutoKey);
            Console.WriteLine(AutoKey + "=" + auto);
            Console.WriteLine("launcher_boot_supported=" + util_is_appbooting_supported_webapp_byappid(TargetApp));
            Console.WriteLine("QUERY_END");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("QUERY_ABORTED=" + ex);
            return 1;
        }
    }
}
