module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: 'android',
        packageImportPath: 'import com.vokve.appicon.VokveAppIconPackage;',
        packageInstance: 'new VokveAppIconPackage()',
      },
    },
  },
};
